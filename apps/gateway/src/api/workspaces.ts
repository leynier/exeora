import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db, schema } from "../db/client.js";
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
});

async function ownedProject(env: Pick<Env, "DB">, userId: string, projectId: string) {
  return db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
}

function view(row: typeof schema.workspaces.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    name: row.name,
    branch: row.branch,
    localPath: row.localPath,
    managed: row.managed,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

workspaces.get("/api/projects/:projectId/workspaces", async (c) => {
  const projectId = c.req.param("projectId");
  if (!(await ownedProject(c.env, c.get("userId"), projectId))) {
    return c.json({ error: "not_found" }, 404);
  }
  const rows = await db(c.env)
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.projectId, projectId))
    .all();
  return c.json(rows.map(view));
});

workspaces.put(
  "/api/projects/:projectId/workspaces/:workspaceId",
  zValidator("json", workspaceInput),
  async (c) => {
    const projectId = c.req.param("projectId");
    const workspaceId = c.req.param("workspaceId");
    if (!/^wsp_[a-zA-Z0-9]+$/.test(workspaceId)) {
      return c.json({ error: "invalid_workspace_id" }, 400);
    }
    if (!(await ownedProject(c.env, c.get("userId"), projectId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const body = c.req.valid("json");
    const existingById = await db(c.env)
      .select({ projectId: schema.workspaces.projectId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .get();
    if (existingById && existingById.projectId !== projectId) {
      return c.json({ error: "not_found" }, 404);
    }
    const collision = await db(c.env)
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.projectId, projectId), eq(schema.workspaces.slug, body.slug)))
      .get();
    if (collision && collision.id !== workspaceId) {
      return c.json({ error: "slug_conflict" }, 409);
    }
    const now = new Date();
    await db(c.env)
      .insert(schema.workspaces)
      .values({
        id: workspaceId,
        projectId,
        slug: body.slug,
        name: body.name,
        branch: body.branch ?? null,
        localPath: body.localPath,
        managed: body.managed,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.workspaces.id,
        set: {
          slug: body.slug,
          name: body.name,
          branch: body.branch ?? null,
          localPath: body.localPath,
          managed: body.managed,
          updatedAt: now,
        },
      });
    const row = await db(c.env)
      .select()
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.id, workspaceId), eq(schema.workspaces.projectId, projectId)))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(view(row));
  },
);

workspaces.delete("/api/projects/:projectId/workspaces/:workspaceId", async (c) => {
  const projectId = c.req.param("projectId");
  if (!(await ownedProject(c.env, c.get("userId"), projectId))) {
    return c.json({ error: "not_found" }, 404);
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
