import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import type { ApiEnv } from "./router.js";

export const worktrees = new Hono<ApiEnv>();

const worktreeInput = z.object({
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

function view(row: typeof schema.worktrees.$inferSelect) {
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

worktrees.get("/api/projects/:projectId/worktrees", async (c) => {
  const projectId = c.req.param("projectId");
  if (!(await ownedProject(c.env, c.get("userId"), projectId))) {
    return c.json({ error: "not_found" }, 404);
  }
  const rows = await db(c.env)
    .select()
    .from(schema.worktrees)
    .where(eq(schema.worktrees.projectId, projectId))
    .all();
  return c.json(rows.map(view));
});

worktrees.put(
  "/api/projects/:projectId/worktrees/:worktreeId",
  zValidator("json", worktreeInput),
  async (c) => {
    const projectId = c.req.param("projectId");
    const worktreeId = c.req.param("worktreeId");
    if (!/^wtr_[a-zA-Z0-9]+$/.test(worktreeId)) {
      return c.json({ error: "invalid_worktree_id" }, 400);
    }
    if (!(await ownedProject(c.env, c.get("userId"), projectId))) {
      return c.json({ error: "not_found" }, 404);
    }
    const body = c.req.valid("json");
    const existingById = await db(c.env)
      .select({ projectId: schema.worktrees.projectId })
      .from(schema.worktrees)
      .where(eq(schema.worktrees.id, worktreeId))
      .get();
    if (existingById && existingById.projectId !== projectId) {
      return c.json({ error: "not_found" }, 404);
    }
    const collision = await db(c.env)
      .select({ id: schema.worktrees.id })
      .from(schema.worktrees)
      .where(and(eq(schema.worktrees.projectId, projectId), eq(schema.worktrees.slug, body.slug)))
      .get();
    if (collision && collision.id !== worktreeId) {
      return c.json({ error: "slug_conflict" }, 409);
    }
    const now = new Date();
    await db(c.env)
      .insert(schema.worktrees)
      .values({
        id: worktreeId,
        projectId,
        slug: body.slug,
        name: body.name,
        branch: body.branch ?? null,
        localPath: body.localPath,
        managed: body.managed,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.worktrees.id,
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
      .from(schema.worktrees)
      .where(and(eq(schema.worktrees.id, worktreeId), eq(schema.worktrees.projectId, projectId)))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(view(row));
  },
);

worktrees.delete("/api/projects/:projectId/worktrees/:worktreeId", async (c) => {
  const projectId = c.req.param("projectId");
  if (!(await ownedProject(c.env, c.get("userId"), projectId))) {
    return c.json({ error: "not_found" }, 404);
  }
  await db(c.env)
    .delete(schema.worktrees)
    .where(
      and(
        eq(schema.worktrees.id, c.req.param("worktreeId")),
        eq(schema.worktrees.projectId, projectId),
      ),
    );
  // Idempotent for CLI reconciliation: a pending delete can be retried safely.
  return c.json({ ok: true });
});
