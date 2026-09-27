import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { chooseWorkspaceSlug } from "../workspace-slugs.js";
import type { ApiEnv } from "./router.js";

export const workspaces = new Hono<ApiEnv>();

const workspaceInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .refine((slug) => slug !== "main", "main is reserved"),
  name: z.string().min(1).max(100),
  branch: z.string().min(1).max(1000).nullable().optional(),
  localPath: z.string().min(1).max(1000),
  managed: z.boolean(),
  /**
   * The machine reporting the checkout, which is where it is. Absent from a
   * CLI older than locations, whose checkouts are on the project's default
   * machine: that is the only place such a CLI could have made them.
   */
  deviceId: z.string().min(1).optional(),
});

async function ownedProject(env: Pick<Env, "DB">, userId: string, projectId: string) {
  return db(env)
    .select({ id: schema.projects.id, deviceId: schema.projects.deviceId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
}

function view(
  row: typeof schema.workspaces.$inferSelect,
  project: { deviceId: string },
  machine: { kind: "local" | "cloud" | "none" | null; machine: string | null },
) {
  return {
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    name: row.name,
    branch: row.branch,
    localPath: row.localPath,
    managed: row.managed,
    /** The machine that holds this checkout. */
    deviceId: row.deviceId ?? project.deviceId,
    /** Whether that machine is one Exeora Cloud runs for this workspace alone. */
    cloud: machine.kind === "cloud",
    machine: machine.machine,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

async function workspaceRows(env: Pick<Env, "DB">, projectId: string, workspaceId?: string) {
  const machine = sql<string>`COALESCE(${schema.workspaces.deviceId}, ${schema.projects.deviceId})`;
  return db(env)
    .select({
      workspace: schema.workspaces,
      kind: schema.devices.kind,
      machine: schema.devices.name,
    })
    .from(schema.workspaces)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.workspaces.projectId))
    .leftJoin(schema.devices, eq(schema.devices.id, machine))
    .where(
      and(
        eq(schema.workspaces.projectId, projectId),
        workspaceId ? eq(schema.workspaces.id, workspaceId) : undefined,
      ),
    )
    .all();
}

workspaces.get("/api/projects/:projectId/workspaces", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await ownedProject(c.env, c.get("userId"), projectId);
  if (!project) return c.json({ error: "not_found" }, 404);
  const rows = await workspaceRows(c.env, projectId);
  return c.json(rows.map((row) => view(row.workspace, project, row)));
});

/** Whether a workspace is a machine of Exeora Cloud, whose row is the machine's and nobody else's. */
async function isCloudWorkspace(env: Pick<Env, "DB">, workspaceId: string): Promise<boolean> {
  const row = await db(env)
    .select({ kind: schema.devices.kind })
    .from(schema.workspaces)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.workspaces.deviceId))
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  return row?.kind === "cloud";
}

workspaces.put(
  "/api/projects/:projectId/workspaces/:workspaceId",
  zValidator("json", workspaceInput),
  async (c) => {
    const projectId = c.req.param("projectId");
    const workspaceId = c.req.param("workspaceId");
    if (!/^wsp_[a-zA-Z0-9]+$/.test(workspaceId)) {
      return c.json({ error: "invalid_workspace_id" }, 400);
    }
    const userId = c.get("userId");
    const project = await ownedProject(c.env, userId, projectId);
    if (!project) return c.json({ error: "not_found" }, 404);
    const body = c.req.valid("json");
    const existingById = await db(c.env)
      .select({ projectId: schema.workspaces.projectId, deviceId: schema.workspaces.deviceId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .get();
    if (existingById && existingById.projectId !== projectId) {
      return c.json({ error: "not_found" }, 404);
    }
    // A cloud workspace is a machine, and its row is the machine's: the CLI
    // on a laptop has nothing to reconcile it with.
    if (await isCloudWorkspace(c.env, workspaceId)) {
      return c.json({ error: "cloud_workspace" }, 409);
    }

    // The machine has to be one of the person's own, and one the project
    // lives on: a checkout reported from anywhere else is not this project's.
    const deviceId = body.deviceId ?? existingById?.deviceId ?? project.deviceId;
    const here = await c.env.DB.prepare(
      `SELECT 1 FROM devices d
        WHERE d.id = ?1 AND d.user_id = ?2 AND d.kind = 'local' AND d.revoked_at IS NULL
          AND (d.id = ?3 OR EXISTS (
            SELECT 1 FROM project_locations l WHERE l.project_id = ?4 AND l.device_id = d.id
          ))`,
    )
      .bind(deviceId, userId, project.deviceId, projectId)
      .first();
    if (!here) return c.json({ error: "not_a_location" }, 409);
    // The same branch may have a workspace in another location of the project
    // already. This one is then stored under the slug with its location behind
    // it, and the answer carries the slug it was given.
    const chosen = await chooseWorkspaceSlug(c.env, {
      projectId,
      wanted: body.slug,
      deviceId,
      workspaceId,
    });
    if ("conflict" in chosen) return c.json({ error: "slug_conflict" }, 409);
    const { slug } = chosen;
    const now = new Date();
    await db(c.env)
      .insert(schema.workspaces)
      .values({
        id: workspaceId,
        projectId,
        slug,
        name: body.name,
        branch: body.branch ?? null,
        localPath: body.localPath,
        managed: body.managed,
        deviceId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.workspaces.id,
        set: {
          slug,
          name: body.name,
          branch: body.branch ?? null,
          localPath: body.localPath,
          managed: body.managed,
          deviceId,
          updatedAt: now,
        },
      });
    const [row] = await workspaceRows(c.env, projectId, workspaceId);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(view(row.workspace, project, row));
  },
);

workspaces.delete("/api/projects/:projectId/workspaces/:workspaceId", async (c) => {
  const projectId = c.req.param("projectId");
  if (!(await ownedProject(c.env, c.get("userId"), projectId))) {
    return c.json({ error: "not_found" }, 404);
  }
  // Deleting a cloud workspace's row here would take its machine record
  // with it and leave the machine itself running; that goes through the
  // Cloud routes, which take the machine down first.
  if (await isCloudWorkspace(c.env, c.req.param("workspaceId"))) {
    return c.json({ error: "cloud_workspace" }, 409);
  }
  await db(c.env)
    .delete(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.id, c.req.param("workspaceId")),
        eq(schema.workspaces.projectId, projectId),
      ),
    );
  // Idempotent for CLI reconciliation: a pending delete can be retried safely.
  return c.json({ ok: true });
});
