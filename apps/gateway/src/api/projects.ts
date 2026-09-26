import { CommandPolicy } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ownedProjectDeletionStatement } from "../audit-deletions.js";
import { parsePolicy } from "../clients.js";
import { destroyCloudProject } from "../cloud/provisioning.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import { limitsFor } from "../plans.js";
import { planOf } from "./plan.js";
import type { ApiEnv } from "./router.js";

/**
 * The directories a machine serves, one row each, and the command policy that
 * applies inside them.
 */

export const projects = new Hono<ApiEnv>();

const projectInput = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens."),
  localPath: z.string().min(1).max(1000),
});

projects.post("/api/projects", zValidator("json", projectInput), async (c) => {
  const body = c.req.valid("json");
  const userId = c.get("userId");

  // Checked rather than trusted: the device id arrives from the client.
  const device = await db(c.env)
    .select({
      id: schema.devices.id,
      kind: schema.devices.kind,
      revokedAt: schema.devices.revokedAt,
    })
    .from(schema.devices)
    .where(and(eq(schema.devices.id, body.deviceId), eq(schema.devices.userId, userId)))
    .get();
  if (!device) return c.json({ error: "unknown_device" }, 400);
  if (device.revokedAt) return c.json({ error: "device_revoked" }, 409);
  // A cloud machine serves exactly the repository it was created for; its
  // projects are made through the Cloud routes, never registered onto it.
  if (device.kind === "cloud") return c.json({ error: "cloud_device" }, 400);

  const existing = await db(c.env)
    .select({ id: schema.projects.id, cloud: schema.cloudProjects.projectId })
    .from(schema.projects)
    .leftJoin(schema.cloudProjects, eq(schema.cloudProjects.projectId, schema.projects.id))
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.slug, body.slug)))
    .get();
  // A cloud project is its machines; pointing it at a laptop would leave the
  // machines behind and send the project's calls to a checkout of their own.
  if (existing?.cloud) return c.json({ error: "cloud_project" }, 409);

  const id = existing?.id ?? newId("prj");

  if (existing) {
    // Re-registering an existing slug does not consume a new slot.
    const result = await db(c.env).run(sql`
      UPDATE projects
         SET device_id = ${body.deviceId}, name = ${body.name}, local_path = ${body.localPath}
       WHERE id = ${id} AND user_id = ${userId}
         AND EXISTS (
           SELECT 1 FROM devices
            WHERE id = ${body.deviceId} AND user_id = ${userId} AND revoked_at IS NULL
         )
    `);
    if ((result.meta.changes ?? 0) === 0) return c.json({ error: "device_revoked" }, 409);
  } else {
    const plan = await planOf(c.env, userId);
    const limits = limitsFor(plan);

    // Same atomic pattern as devices: the cap lives in the INSERT, not in a
    // prior SELECT that a second request could race.
    if (limits.maxProjects !== null) {
      const result = await db(c.env).run(
        sql`
            INSERT INTO projects (id, user_id, device_id, name, slug, local_path)
            SELECT ${id}, ${userId}, ${body.deviceId}, ${body.name}, ${body.slug}, ${body.localPath}
            FROM devices
            WHERE id = ${body.deviceId}
              AND user_id = ${userId}
              AND revoked_at IS NULL
              AND (
              SELECT COUNT(*) FROM projects WHERE user_id = ${userId}
            ) < ${limits.maxProjects}
          `,
      );

      if ((result.meta.changes ?? 0) === 0) {
        if (!(await deviceIsActive(c.env, userId, body.deviceId))) {
          return c.json({ error: "device_revoked" }, 409);
        }
        return c.json(
          { error: "plan_limit", limit: "projects", max: limits.maxProjects, plan },
          403,
        );
      }
    } else {
      const result = await db(c.env).run(sql`
        INSERT INTO projects (id, user_id, device_id, name, slug, local_path)
        SELECT ${id}, ${userId}, ${body.deviceId}, ${body.name}, ${body.slug}, ${body.localPath}
        FROM devices
        WHERE id = ${body.deviceId} AND user_id = ${userId} AND revoked_at IS NULL
      `);
      if ((result.meta.changes ?? 0) === 0) return c.json({ error: "device_revoked" }, 409);
    }
  }

  return c.json({ id, slug: body.slug, name: body.name }, existing ? 200 : 201);
});

async function deviceIsActive(env: Pick<Env, "DB">, userId: string, deviceId: string) {
  return Boolean(
    await db(env)
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(
        and(
          eq(schema.devices.id, deviceId),
          eq(schema.devices.userId, userId),
          isNull(schema.devices.revokedAt),
        ),
      )
      .get(),
  );
}

projects.get("/api/projects", async (c) => {
  // The cloud row rides along so the dashboard can tell a repository on an
  // Exeora machine from a directory on the user's own, in one request.
  const rows = await db(c.env)
    .select({
      project: schema.projects,
      repoUrl: schema.cloudProjects.repoUrl,
      defaultBranch: schema.cloudProjects.defaultBranch,
    })
    .from(schema.projects)
    .leftJoin(schema.cloudProjects, eq(schema.cloudProjects.projectId, schema.projects.id))
    .where(eq(schema.projects.userId, c.get("userId")))
    .all();

  return c.json(
    rows.map(({ project, repoUrl, defaultBranch }) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      deviceId: project.deviceId,
      localPath: project.localPath,
      mcpUrl: new URL(`/p/${project.id}/mcp`, c.env.EXEORA_BASE_URL).toString(),
      policy: parsePolicy(project.commandPolicy),
      createdAt: project.createdAt.getTime(),
      cloud: repoUrl !== null && defaultBranch !== null ? { repoUrl, defaultBranch } : null,
    })),
  );
});

/**
 * Sets what an agent may do in this project.
 *
 * Validated against the shared schema rather than a copy, so a policy the
 * dashboard can save is one the executor will understand. Stored as JSON in one
 * column because it is read and written whole and never queried by its parts.
 */
projects.put("/api/projects/:id/policy", zValidator("json", CommandPolicy), async (c) => {
  const policy = c.req.valid("json");

  const result = await db(c.env)
    .update(schema.projects)
    .set({ commandPolicy: JSON.stringify(policy) })
    .where(
      and(eq(schema.projects.id, c.req.param("id")), eq(schema.projects.userId, c.get("userId"))),
    )
    .run();

  if (result.meta.changes === 0) return c.json({ error: "not_found" }, 404);

  // No cache to clear and no socket to notify: the policy travels with the next
  // tool call, so this takes effect on the very next one.
  return c.json(policy);
});

projects.delete("/api/projects/:id", async (c) => {
  const projectId = c.req.param("id");
  const userId = c.get("userId");
  // A cloud project is its machines: deleting it means taking those down,
  // and the last of them takes the project's row with it.
  if (await destroyCloudProject(c.env, userId, projectId)) return c.json({ ok: true }, 202);
  const results = await c.env.DB.batch([
    ownedProjectDeletionStatement(c.env, userId, projectId),
    c.env.DB.prepare("DELETE FROM audit_outbox WHERE project_id = ?1 AND user_id = ?2").bind(
      projectId,
      userId,
    ),
    c.env.DB.prepare("DELETE FROM projects WHERE id = ?1 AND user_id = ?2").bind(projectId, userId),
  ]);

  if ((results.at(-1)?.meta.changes ?? 0) === 0) return c.json({ error: "not_found" }, 404);

  return c.json({ ok: true });
});
