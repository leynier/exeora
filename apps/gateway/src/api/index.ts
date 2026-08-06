import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";

/**
 * The dashboard and CLI API. Everything here runs behind `apiRoute`, so the
 * OAuth provider has already validated the bearer token; `ctx.props` carries
 * the grant's props and is the only source of the caller's identity.
 *
 * Every query is filtered by that user id. There is no "admin" path and no
 * lookup by id alone, so a guessed device or project id cannot cross accounts.
 */

type Variables = { userId: string };

export const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.use("/api/*", async (c, next) => {
  const props = (c.executionCtx as unknown as { props?: { userId?: string } }).props;
  const userId = props?.userId;
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
});

api.get("/api/health", (c) => c.json({ ok: true, service: "exeora-gateway" }));

api.get("/api/me", async (c) => {
  const user = await db(c.env)
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, c.get("userId")))
    .get();

  return user ? c.json(user) : c.json({ error: "not_found" }, 404);
});

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

const deviceInput = z.object({
  name: z.string().min(1).max(100),
  platform: z.string().min(1).max(50),
  cliVersion: z.string().max(50).optional(),
});

api.post("/api/devices", zValidator("json", deviceInput), async (c) => {
  const body = c.req.valid("json");
  const id = newId("dev");

  await db(c.env)
    .insert(schema.devices)
    .values({
      id,
      userId: c.get("userId"),
      name: body.name,
      platform: body.platform,
      cliVersion: body.cliVersion ?? null,
    })
    .run();

  return c.json({ id, name: body.name, platform: body.platform }, 201);
});

api.get("/api/devices", async (c) => {
  const rows = await db(c.env)
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.userId, c.get("userId")))
    .all();

  return c.json(rows.map(toDeviceView));
});

/**
 * Revocation is a soft delete: the row stays so the audit log keeps its
 * references, and the relay refuses a socket whose device has `revokedAt` set.
 */
api.delete("/api/devices/:id", async (c) => {
  const result = await db(c.env)
    .update(schema.devices)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.devices.id, c.req.param("id")), eq(schema.devices.userId, c.get("userId"))),
    )
    .run();

  if (result.meta.changes === 0) return c.json({ error: "not_found" }, 404);

  // Close any live socket immediately, rather than waiting for the executor to
  // notice on its next call.
  await c.env.DEVICE_RELAY.getByName(relayName(c.get("userId"), c.req.param("id"))).revoke();

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

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

api.post("/api/projects", zValidator("json", projectInput), async (c) => {
  const body = c.req.valid("json");
  const userId = c.get("userId");

  // Checked rather than trusted: the device id arrives from the client.
  const device = await db(c.env)
    .select({ id: schema.devices.id })
    .from(schema.devices)
    .where(and(eq(schema.devices.id, body.deviceId), eq(schema.devices.userId, userId)))
    .get();
  if (!device) return c.json({ error: "unknown_device" }, 400);

  const existing = await db(c.env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), eq(schema.projects.slug, body.slug)))
    .get();

  const id = existing?.id ?? newId("prj");

  if (existing) {
    await db(c.env)
      .update(schema.projects)
      .set({ deviceId: body.deviceId, name: body.name, localPath: body.localPath })
      .where(eq(schema.projects.id, id))
      .run();
  } else {
    await db(c.env)
      .insert(schema.projects)
      .values({ id, userId, ...body })
      .run();
  }

  return c.json({ id, slug: body.slug, name: body.name }, existing ? 200 : 201);
});

api.get("/api/projects", async (c) => {
  const rows = await db(c.env)
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, c.get("userId")))
    .all();

  return c.json(
    rows.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      deviceId: project.deviceId,
      localPath: project.localPath,
      mcpUrl: new URL(`/p/${project.id}/mcp`, c.env.EXEORA_BASE_URL).toString(),
      createdAt: project.createdAt.getTime(),
    })),
  );
});

api.delete("/api/projects/:id", async (c) => {
  const result = await db(c.env)
    .delete(schema.projects)
    .where(
      and(eq(schema.projects.id, c.req.param("id")), eq(schema.projects.userId, c.get("userId"))),
    )
    .run();

  return result.meta.changes === 0 ? c.json({ error: "not_found" }, 404) : c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

api.get("/api/tool-calls", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const rows = await db(c.env)
    .select()
    .from(schema.toolCalls)
    .where(eq(schema.toolCalls.userId, c.get("userId")))
    .orderBy(desc(schema.toolCalls.createdAt))
    .limit(limit)
    .all();

  return c.json(
    rows.map((call) => ({
      id: call.id,
      projectId: call.projectId,
      tool: call.tool,
      status: call.status,
      durationMs: call.durationMs,
      errorCode: call.errorCode,
      clientId: call.clientId,
      createdAt: call.createdAt.getTime(),
    })),
  );
});

// ---------------------------------------------------------------------------

export function relayName(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

function toDeviceView(device: typeof schema.devices.$inferSelect) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    cliVersion: device.cliVersion,
    lastSeenAt: device.lastSeenAt?.getTime() ?? null,
    revokedAt: device.revokedAt?.getTime() ?? null,
    createdAt: device.createdAt.getTime(),
  };
}
