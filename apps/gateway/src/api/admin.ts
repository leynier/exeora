import { HEARTBEAT_TIMEOUT_MS } from "@exeora/protocol";
import { and, count, desc, eq, gt, isNull, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { deleteAccount, revokeClient, revokeDevice } from "./ops.js";

/**
 * Administration panel API.
 *
 * Only people whose email is in `admin_users` can reach these routes. Everyone
 * else gets a plain 404: the surface is not advertised, and a 403 would confirm
 * that it exists. The shared `/api/*` middleware has already bound `userId`
 * before anything here runs.
 */

type Variables = { userId: string };

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use("/api/admin/*", async (c, next) => {
  const user = await db(c.env)
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, c.get("userId")))
    .get();

  if (!user) return c.json({ error: "not_found" }, 404);

  const allowed = await db(c.env)
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, user.email))
    .get();

  if (!allowed) return c.json({ error: "not_found" }, 404);

  await next();
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

admin.get("/api/admin/overview", async (c) => {
  const database = db(c.env);
  const seenSince = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    usersRow,
    devicesRow,
    onlineRow,
    projectsRow,
    clientsRow,
    callsRow,
    dayRow,
    weekRow,
    weekErrorRow,
  ] = await Promise.all([
    database.select({ n: count() }).from(schema.users).get(),
    database.select({ n: count() }).from(schema.devices).get(),
    database
      .select({ n: count() })
      .from(schema.devices)
      .where(and(isNull(schema.devices.revokedAt), gt(schema.devices.lastSeenAt, seenSince)))
      .get(),
    database.select({ n: count() }).from(schema.projects).get(),
    database
      .select({ n: count() })
      .from(schema.projectClients)
      .where(isNull(schema.projectClients.revokedAt))
      .get(),
    database.select({ n: count() }).from(schema.toolCalls).get(),
    database
      .select({ n: count() })
      .from(schema.toolCalls)
      .where(gt(schema.toolCalls.createdAt, dayAgo))
      .get(),
    database
      .select({ n: count() })
      .from(schema.toolCalls)
      .where(gt(schema.toolCalls.createdAt, weekAgo))
      .get(),
    database
      .select({ n: count() })
      .from(schema.toolCalls)
      .where(and(gt(schema.toolCalls.createdAt, weekAgo), eq(schema.toolCalls.status, "error")))
      .get(),
  ]);

  const calls7d = weekRow?.n ?? 0;
  const errors7d = weekErrorRow?.n ?? 0;

  return c.json({
    users: usersRow?.n ?? 0,
    devices: devicesRow?.n ?? 0,
    devicesOnline: onlineRow?.n ?? 0,
    projects: projectsRow?.n ?? 0,
    clients: clientsRow?.n ?? 0,
    toolCalls: callsRow?.n ?? 0,
    toolCalls24h: dayRow?.n ?? 0,
    toolCalls7d: calls7d,
    errorRate7d: calls7d === 0 ? 0 : errors7d / calls7d,
  });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

admin.get("/api/admin/users", async (c) => {
  const database = db(c.env);
  const seenSinceMs = Date.now() - HEARTBEAT_TIMEOUT_MS;

  // One query with correlated subselects rather than N+1: the panel is small
  // and the counts are what make the list useful at a glance.
  const rows = await database
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      createdAt: schema.users.createdAt,
      devices:
        sql<number>`(select count(*) from ${schema.devices} where ${schema.devices.userId} = ${schema.users.id})`.mapWith(
          Number,
        ),
      devicesOnline:
        sql<number>`(select count(*) from ${schema.devices} where ${schema.devices.userId} = ${schema.users.id} and ${schema.devices.revokedAt} is null and ${schema.devices.lastSeenAt} > ${seenSinceMs})`.mapWith(
          Number,
        ),
      projects:
        sql<number>`(select count(*) from ${schema.projects} where ${schema.projects.userId} = ${schema.users.id})`.mapWith(
          Number,
        ),
      clients:
        sql<number>`(select count(*) from ${schema.projectClients} where ${schema.projectClients.userId} = ${schema.users.id} and ${schema.projectClients.revokedAt} is null)`.mapWith(
          Number,
        ),
      toolCalls:
        sql<number>`(select count(*) from ${schema.toolCalls} where ${schema.toolCalls.userId} = ${schema.users.id})`.mapWith(
          Number,
        ),
      lastActivityAt: max(schema.toolCalls.createdAt),
    })
    .from(schema.users)
    .leftJoin(schema.toolCalls, eq(schema.toolCalls.userId, schema.users.id))
    .groupBy(schema.users.id)
    .orderBy(desc(schema.users.createdAt))
    .all();

  return c.json(
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatarUrl,
      createdAt: row.createdAt.getTime(),
      devices: row.devices,
      devicesOnline: row.devicesOnline,
      projects: row.projects,
      clients: row.clients,
      toolCalls: row.toolCalls,
      lastActivityAt: row.lastActivityAt?.getTime() ?? null,
    })),
  );
});

admin.get("/api/admin/users/:id", async (c) => {
  const database = db(c.env);
  const userId = c.req.param("id");
  const seenSince = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

  const user = await database
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) return c.json({ error: "not_found" }, 404);

  const [devices, projects, clients, toolCallCount, recentCalls, lastActivity] = await Promise.all([
    database
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.userId, userId))
      .orderBy(desc(schema.devices.createdAt))
      .all(),
    database
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.userId, userId))
      .orderBy(desc(schema.projects.createdAt))
      .all(),
    database
      .select()
      .from(schema.projectClients)
      .where(eq(schema.projectClients.userId, userId))
      .orderBy(desc(schema.projectClients.authorizedAt))
      .all(),
    database
      .select({ n: count() })
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.userId, userId))
      .get(),
    database
      .select()
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.userId, userId))
      .orderBy(desc(schema.toolCalls.createdAt))
      .limit(20)
      .all(),
    database
      .select({ at: max(schema.toolCalls.createdAt) })
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.userId, userId))
      .get(),
  ]);

  const devicesOnline = devices.filter(
    (device) =>
      device.revokedAt === null &&
      device.lastSeenAt !== null &&
      device.lastSeenAt.getTime() > seenSince.getTime(),
  ).length;

  const activeClients = clients.filter((client) => client.revokedAt === null).length;

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.getTime(),
    devices: devices.length,
    devicesOnline,
    projects: projects.length,
    clients: activeClients,
    toolCalls: toolCallCount?.n ?? 0,
    lastActivityAt: lastActivity?.at?.getTime() ?? null,
    machineList: devices.map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform,
      cliVersion: device.cliVersion,
      lastSeenAt: device.lastSeenAt?.getTime() ?? null,
      revokedAt: device.revokedAt?.getTime() ?? null,
      createdAt: device.createdAt.getTime(),
    })),
    projectList: projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      deviceId: project.deviceId,
      localPath: project.localPath,
      createdAt: project.createdAt.getTime(),
    })),
    clientList: clients.map((client) => ({
      id: client.id,
      projectId: client.projectId,
      endpoint: client.endpoint,
      clientId: client.clientId,
      clientName: client.clientName,
      clientUri: client.clientUri,
      mcpName: client.mcpName,
      mcpVersion: client.mcpVersion,
      authorizedAt: client.authorizedAt.getTime(),
      lastUsedAt: client.lastUsedAt?.getTime() ?? null,
      revokedAt: client.revokedAt?.getTime() ?? null,
    })),
    recentCalls: recentCalls.map((call) => ({
      id: call.id,
      projectId: call.projectId,
      tool: call.tool,
      status: call.status,
      durationMs: call.durationMs,
      errorCode: call.errorCode,
      clientId: call.clientId,
      clientName: call.clientName,
      createdAt: call.createdAt.getTime(),
    })),
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * An admin manages their own account from Settings, not from this panel. Acting
 * on yourself here is almost always a mistake (and can lock the only admin out).
 */
function refuseSelf(c: { get: (k: "userId") => string }, targetUserId: string) {
  if (c.get("userId") === targetUserId) {
    return true;
  }
  return false;
}

admin.delete("/api/admin/users/:userId/devices/:id", async (c) => {
  const userId = c.req.param("userId");
  if (refuseSelf(c, userId)) return c.json({ error: "use_own_settings" }, 400);

  const ok = await revokeDevice(c.env, userId, c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

admin.delete("/api/admin/users/:userId/clients/:id", async (c) => {
  const userId = c.req.param("userId");
  if (refuseSelf(c, userId)) return c.json({ error: "use_own_settings" }, 400);

  const ok = await revokeClient(c.env, userId, c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

admin.delete("/api/admin/users/:id", async (c) => {
  const userId = c.req.param("id");
  if (refuseSelf(c, userId)) return c.json({ error: "use_own_settings" }, 400);

  const user = await db(c.env)
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) return c.json({ error: "not_found" }, 404);

  await deleteAccount(c.env, userId);
  return c.json({ ok: true });
});
