import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { isMetadataDocumentClient, usedElsewhere } from "../clients.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import { getCliClientId, getDashboardClientId } from "../oauth/clients.js";

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

/**
 * Permanent deletion, allowed only once a machine is revoked.
 *
 * Two steps rather than one on purpose: revoking is the urgent action and has
 * to stay a single click, while this one cannot be undone and takes the
 * machine's projects and their audit history with it through the foreign keys.
 * Requiring the machine to be stopped first means nobody reaches this by
 * misclicking next to `Revoke`.
 */
api.delete("/api/devices/:id/permanently", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const device = await db(c.env)
    .select({ revokedAt: schema.devices.revokedAt })
    .from(schema.devices)
    .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, userId)))
    .get();

  if (!device) return c.json({ error: "not_found" }, 404);
  if (device.revokedAt === null) return c.json({ error: "not_revoked" }, 409);

  // projects cascade from devices, and tool_calls cascade from projects, so
  // this one statement removes all three.
  await db(c.env)
    .delete(schema.devices)
    .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, userId)))
    .run();

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
// Clients
// ---------------------------------------------------------------------------

/**
 * Every AI client authorized against one of the user's projects.
 *
 * Returned flat, with the project id on each row, because both consumers want
 * it differently: the Clients tab groups by project and the project page filters
 * to one. That is the same shape, and the same reasoning, as the audit log.
 */
api.get("/api/clients", async (c) => {
  const rows = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(eq(schema.projectClients.userId, c.get("userId")))
    .orderBy(desc(schema.projectClients.authorizedAt))
    .all();

  return c.json(rows.map(toClientView));
});

/**
 * Revocation is a soft delete, as it is for machines: the row stays so the
 * dashboard can offer the second step, and the tool endpoint refuses a call
 * whose client has `revokedAt` set.
 *
 * The grants are what actually carry access, so they go too. A client may hold
 * several for the same project, one per time it was authorized, and every one
 * of them has to be found by the project id we recorded in its metadata.
 */
api.delete("/api/clients/:id", async (c) => {
  const userId = c.get("userId");

  const client = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.id, c.req.param("id")),
        eq(schema.projectClients.userId, userId),
      ),
    )
    .get();

  if (!client) return c.json({ error: "not_found" }, 404);

  await db(c.env)
    .update(schema.projectClients)
    .set({ revokedAt: new Date() })
    .where(eq(schema.projectClients.id, client.id))
    .run();

  await revokeGrantsFor(c.env, userId, client.projectId, client.clientId);

  return c.json({ ok: true });
});

/**
 * Permanent deletion, allowed only once a client is revoked.
 *
 * Takes this project's audit history for that client with it, which is why it
 * is the second of two steps rather than the only one, exactly as for machines.
 */
api.delete("/api/clients/:id/permanently", async (c) => {
  const userId = c.get("userId");

  const client = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.id, c.req.param("id")),
        eq(schema.projectClients.userId, userId),
      ),
    )
    .get();

  if (!client) return c.json({ error: "not_found" }, 404);
  if (client.revokedAt === null) return c.json({ error: "not_revoked" }, 409);

  await db(c.env)
    .delete(schema.toolCalls)
    .where(
      and(
        eq(schema.toolCalls.userId, userId),
        eq(schema.toolCalls.projectId, client.projectId),
        eq(schema.toolCalls.clientId, client.clientId),
      ),
    )
    .run();

  await db(c.env)
    .delete(schema.projectClients)
    .where(eq(schema.projectClients.id, client.id))
    .run();

  await forgetOAuthClient(c.env, userId, client.clientId);

  return c.json({ ok: true });
});

/** Drops every grant this user holds for one client on one project. */
async function revokeGrantsFor(
  env: Env,
  userId: string,
  projectId: string,
  clientId: string,
): Promise<void> {
  try {
    let cursor: string | undefined;

    do {
      const page = await env.OAUTH_PROVIDER.listUserGrants(userId, {
        ...(cursor ? { cursor } : {}),
      });

      for (const grant of page.items) {
        if (grant.clientId !== clientId) continue;
        if ((grant.metadata as { projectId?: string } | null)?.projectId !== projectId) continue;
        await env.OAUTH_PROVIDER.revokeGrant(grant.id, userId);
      }

      cursor = page.cursor;
    } while (cursor);
  } catch {
    // The row is already marked revoked and the MCP endpoint reads that on
    // every call, so access is closed either way. Failing the request here
    // would only make the user think it was not.
  }
}

/**
 * Unregisters the OAuth client itself, once nothing of the user's points at it.
 *
 * Clients are global objects: one registration can be shared by several
 * accounts, and there is no way to ask the provider who else holds a grant for
 * one. So this refuses the two cases that are knowably shared — a metadata
 * document, whose id is a URL published by the client's author, and Exeora's
 * own CLI and dashboard — and accepts that a DCR registration shared between
 * accounts is not detectable from here.
 */
async function forgetOAuthClient(env: Env, userId: string, clientId: string): Promise<void> {
  try {
    if (isMetadataDocumentClient(clientId)) return;
    if (await usedElsewhere(env, { userId, clientId })) return;

    const [cli, dashboard] = await Promise.all([getCliClientId(env), getDashboardClientId(env)]);
    if (clientId === cli || clientId === dashboard) return;

    await env.OAUTH_PROVIDER.deleteClient(clientId);
  } catch {
    // The client is already gone from the user's account; a stale registration
    // in KV is not worth failing the deletion they asked for.
  }
}

function toClientView(client: typeof schema.projectClients.$inferSelect) {
  return {
    id: client.id,
    projectId: client.projectId,
    clientId: client.clientId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    mcpName: client.mcpName,
    mcpVersion: client.mcpVersion,
    authorizedAt: client.authorizedAt.getTime(),
    lastUsedAt: client.lastUsedAt?.getTime() ?? null,
    revokedAt: client.revokedAt?.getTime() ?? null,
  };
}

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
      clientName: call.clientName,
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
