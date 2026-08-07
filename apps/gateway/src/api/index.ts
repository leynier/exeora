import { CommandPolicy, HEARTBEAT_TIMEOUT_MS } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  isMetadataDocumentClient,
  parsePolicy,
  rememberAuthorization,
  revokeAccountProjectsExcept,
  setActiveProjectId,
  stillAuthorized,
} from "../clients.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import { ACCOUNT_MCP_ROUTE } from "../mcp-account.js";
import { getCliClientId, getDashboardClientId } from "../oauth/clients.js";
import { ownedProjectIds } from "../oauth/target.js";

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

  return user
    ? c.json({
        ...user,
        // The one URL that is the same for every account. Sent from here rather
        // than written into the dashboard so it follows `EXEORA_BASE_URL` in
        // development, exactly as every project's own URL does.
        accountMcpUrl: new URL(ACCOUNT_MCP_ROUTE, c.env.EXEORA_BASE_URL).toString(),
      })
    : c.json({ error: "not_found" }, 404);
});

/**
 * Deletes the account and everything hanging off it.
 *
 * The order is the whole design. Machines are cut off first, because a socket
 * that is still open is the only thing here that can still run a command;
 * grants next, so no token outlives the row it was issued against; then the
 * user, whose foreign keys take the devices, projects, authorizations and audit
 * history with them in one statement. Unregistering the clients comes last,
 * because whether a client is still needed is answered by the rows that step
 * has just removed.
 *
 * Not reversible and deliberately not a soft delete: an account someone asked
 * to have deleted is not a record to keep.
 */
api.delete("/api/me", async (c) => {
  const userId = c.get("userId");
  const database = db(c.env);

  const devices = await database
    .select({ id: schema.devices.id })
    .from(schema.devices)
    .where(eq(schema.devices.userId, userId))
    .all();

  for (const device of devices) {
    // Sequential rather than in parallel: each one is a call into a different
    // Durable Object, and there is no deadline pressure on a deletion.
    await c.env.DEVICE_RELAY.getByName(relayName(userId, device.id)).revoke();
  }

  await revokeGrants(c.env, userId, () => true);

  // Read before the delete, since afterwards there is nothing left to read.
  const authorized = await database
    .selectDistinct({ clientId: schema.projectClients.clientId })
    .from(schema.projectClients)
    .where(eq(schema.projectClients.userId, userId))
    .all();

  await database.delete(schema.users).where(eq(schema.users.id, userId)).run();

  for (const client of authorized) {
    await forgetOAuthClient(c.env, client.clientId);
  }

  return c.json({ ok: true });
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
      policy: parsePolicy(project.commandPolicy),
      createdAt: project.createdAt.getTime(),
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
api.put("/api/projects/:id/policy", zValidator("json", CommandPolicy), async (c) => {
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

  await revokeGrantsAfter(c.env, userId, client);

  return c.json({ ok: true });
});

/**
 * Drops whatever grants the row that was just revoked was carrying.
 *
 * The two endpoints need different answers because their grants mean different
 * things. A per-project grant names one project and does nothing else, so
 * revoking that project revokes the grant. An account grant names `/mcp`, which
 * every project on that connection shares, so taking one project away must
 * leave it alone; only the last one closes it.
 */
async function revokeGrantsAfter(
  env: Env,
  userId: string,
  client: typeof schema.projectClients.$inferSelect,
): Promise<void> {
  if (client.endpoint === "project") {
    await revokeGrantsFor(env, userId, client.projectId, client.clientId);
    return;
  }

  const remaining = await db(env)
    .select({ id: schema.projectClients.id })
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.userId, userId),
        eq(schema.projectClients.clientId, client.clientId),
        eq(schema.projectClients.endpoint, "account"),
        isNull(schema.projectClients.revokedAt),
      ),
    )
    .all();

  if (remaining.length > 0) return;

  // Same ending as emptying the list from the account view: with nothing left
  // to reach, the token goes too.
  await revokeAccountGrants(env, userId, client.clientId);
}

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

  // The same client can reach the same project through both URLs, and the audit
  // log records the call rather than the door it came through. Deleting the
  // history while the other way in still exists would erase a record its own
  // row is still offering to show, so it waits until this is the last one.
  const sibling = await db(c.env)
    .select({ id: schema.projectClients.id })
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.userId, userId),
        eq(schema.projectClients.projectId, client.projectId),
        eq(schema.projectClients.clientId, client.clientId),
        eq(schema.projectClients.endpoint, client.endpoint === "project" ? "account" : "project"),
      ),
    )
    .get();

  if (!sibling) {
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
  }

  await db(c.env)
    .delete(schema.projectClients)
    .where(eq(schema.projectClients.id, client.id))
    .run();

  // The pointer outlives a revocation on purpose, so a call can be refused
  // rather than quietly moved. It must not outlive *this*, which erases the
  // client's record rather than closing its access: there is no agent left to
  // protect, and the leftover row would meet the same client on its next
  // authorization and refuse its very first call, naming a project chosen by a
  // connection the user asked to forget.
  const remainingAccount = await db(c.env)
    .select({ id: schema.projectClients.id })
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.userId, userId),
        eq(schema.projectClients.clientId, client.clientId),
        eq(schema.projectClients.endpoint, "account"),
      ),
    )
    .get();

  if (!remainingAccount) {
    await setActiveProjectId(c.env, { userId, clientId: client.clientId, projectId: null });
  }

  await forgetOAuthClient(c.env, client.clientId);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Account-endpoint clients
// ---------------------------------------------------------------------------

/**
 * The clients connected through the account URL, one entry each.
 *
 * Grouped here rather than in the dashboard because the grouping is the whole
 * point of the view: on this endpoint a client is one connection covering
 * several projects, and listing it once per project would describe it as
 * several connections that happen to share a name.
 */
api.get("/api/account-clients", async (c) => {
  const userId = c.get("userId");

  const [rows, active] = await Promise.all([
    db(c.env)
      .select()
      .from(schema.projectClients)
      .where(
        and(
          eq(schema.projectClients.userId, userId),
          eq(schema.projectClients.endpoint, "account"),
        ),
      )
      .orderBy(desc(schema.projectClients.authorizedAt))
      .all(),
    db(c.env)
      .select()
      .from(schema.activeProjects)
      .where(eq(schema.activeProjects.userId, userId))
      .all(),
  ]);

  const activeByClient = new Map(active.map((row) => [row.clientId, row.projectId]));
  const byClient = new Map<string, ReturnType<typeof toAccountClientView>>();

  for (const row of rows) {
    const existing = byClient.get(row.clientId);
    if (!existing) {
      byClient.set(row.clientId, {
        ...toAccountClientView(row),
        activeProjectId: activeByClient.get(row.clientId) ?? null,
        projects: [toAccountProjectView(row)],
      });
      continue;
    }

    existing.projects.push(toAccountProjectView(row));

    // Folded across every row rather than read off the first one. A call on
    // this endpoint resolves to one project and only marks that project's row,
    // so the newest-authorized row is routinely not the one that was last used
    // and reading it alone would report a busy connection as never used. The
    // same for what the client called itself, which only one row may carry.
    existing.lastUsedAt = latest(existing.lastUsedAt, row.lastUsedAt?.getTime() ?? null);
    existing.mcpName ??= row.mcpName;
    existing.mcpVersion ??= row.mcpVersion;
    existing.clientName ??= row.clientName;
    existing.clientUri ??= row.clientUri;
  }

  // The pointer outlives a revocation on purpose, so that resolving a call can
  // tell "never chose" from "chose something now gone" and refuse rather than
  // silently move the client. That distinction is worth nothing to this screen,
  // which only draws where the connection is working: a choice it can no longer
  // reach is not one, and offering it in the dropdown would invite picking it.
  for (const client of byClient.values()) {
    const reaches = new Set(
      client.projects.filter((entry) => entry.revokedAt === null).map((entry) => entry.projectId),
    );
    if (client.activeProjectId && !reaches.has(client.activeProjectId)) {
      client.activeProjectId = null;
    }
  }

  return c.json([...byClient.values()]);
});

const accessInput = z.object({
  // In the body rather than the path: under CIMD a client id is a URL, and a
  // URL inside a path segment is a percent-encoding problem waiting to happen.
  clientId: z.string().min(1),
  projectIds: z.array(z.string().min(1)),
});

/**
 * Sets which projects a client reaches through the account URL.
 *
 * The same statement the consent screen makes, from the other side: what is in
 * the list is granted or restored, and what is missing is revoked. Revoking
 * rather than deleting, so the audit history stays attributable.
 *
 * Never touches `endpoint = "project"` rows. Access given through a project's
 * own URL is a different consent, and this page is not where it is answered.
 */
api.put("/api/account-clients/projects", zValidator("json", accessInput), async (c) => {
  const userId = c.get("userId");
  const { clientId, projectIds } = c.req.valid("json");

  const existing = await db(c.env)
    .select()
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.userId, userId),
        eq(schema.projectClients.clientId, clientId),
        eq(schema.projectClients.endpoint, "account"),
      ),
    )
    .all();

  if (existing.length === 0) return c.json({ error: "not_found" }, 404);

  // The same narrowing the consent screen does with its tick boxes, and for the
  // same reason: the list is caller-controlled, so an id that is not this
  // user's is dropped rather than refused.
  const keep = await ownedProjectIds(c.env, userId, projectIds);

  // An empty list is how this page cuts a connection off, and the dashboard
  // asks before sending one. A list that arrives non-empty and narrows to
  // nothing is not that decision: every id in it was stale or someone else's,
  // so the request meant "keep these" and answering it by taking the token away
  // would be the opposite, unasked and not undoable from here.
  if (projectIds.length > 0 && keep.length === 0) return c.json({ error: "not_found" }, 404);

  // Identity is copied from a row that already exists rather than looked up in
  // KV: it is the same client, and this is not a new authorization. A row that
  // carries a name is preferred, because these come back in no particular order
  // and copying a nameless one would blank the name everywhere it lands.
  const identity = existing.find((row) => row.clientName !== null) ?? existing[0];
  if (!identity) return c.json({ error: "not_found" }, 404);

  // Only what is not already granted. `rememberAuthorization` stamps
  // `authorizedAt`, which is when consent was given, and editing the list here
  // is not a new consent for the projects it leaves alone: writing to them
  // would make the dashboard report every untouched project as authorized just
  // now, on an edit that only took one away.
  const alreadyGranted = new Set(
    existing.filter((row) => row.revokedAt === null).map((row) => row.projectId),
  );

  for (const projectId of keep) {
    if (alreadyGranted.has(projectId)) continue;

    await rememberAuthorization(c.env, {
      userId,
      projectId,
      clientId,
      endpoint: "account",
      clientName: identity.clientName ?? undefined,
      clientUri: identity.clientUri ?? undefined,
    });
  }

  await revokeAccountProjectsExcept(c.env, { userId, clientId, keep });

  // Emptying the list is how this screen shuts a connection off, so it also
  // takes the token, exactly as revoking the last project one at a time does.
  // Leaving the grant alive would let a client that reaches nothing keep asking.
  if (keep.length === 0) await revokeAccountGrants(c.env, userId, clientId);

  return c.json({ ok: true });
});

/** Drops the grants a client holds for the account endpoint, and only those. */
async function revokeAccountGrants(env: Env, userId: string, clientId: string): Promise<void> {
  await revokeGrants(
    env,
    userId,
    (grant) =>
      grant.clientId === clientId &&
      Array.isArray((grant.metadata as { projectIds?: unknown } | null)?.projectIds),
  );
}

const activeInput = z.object({
  clientId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
});

/** Points a client at a project from the dashboard, or clears the pointer. */
api.put("/api/account-clients/active-project", zValidator("json", activeInput), async (c) => {
  const userId = c.get("userId");
  const { clientId, projectId } = c.req.valid("json");

  if (projectId !== null) {
    const granted = await db(c.env)
      .select({ id: schema.projectClients.id })
      .from(schema.projectClients)
      .where(
        and(
          eq(schema.projectClients.userId, userId),
          eq(schema.projectClients.clientId, clientId),
          eq(schema.projectClients.projectId, projectId),
          eq(schema.projectClients.endpoint, "account"),
          isNull(schema.projectClients.revokedAt),
        ),
      )
      .get();

    if (!granted) return c.json({ error: "not_found" }, 404);
  }

  await setActiveProjectId(c.env, { userId, clientId, projectId });
  return c.json({ ok: true });
});

function toAccountClientView(client: typeof schema.projectClients.$inferSelect) {
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    mcpName: client.mcpName,
    mcpVersion: client.mcpVersion,
    authorizedAt: client.authorizedAt.getTime(),
    lastUsedAt: client.lastUsedAt?.getTime() ?? null,
    activeProjectId: null as string | null,
    projects: [] as ReturnType<typeof toAccountProjectView>[],
  };
}

function toAccountProjectView(client: typeof schema.projectClients.$inferSelect) {
  return {
    id: client.id,
    projectId: client.projectId,
    revokedAt: client.revokedAt?.getTime() ?? null,
  };
}

/** The later of two timestamps, either of which may be missing. */
function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Drops every grant this user holds for one client on one project. */
async function revokeGrantsFor(
  env: Env,
  userId: string,
  projectId: string,
  clientId: string,
): Promise<void> {
  await revokeGrants(
    env,
    userId,
    (grant) =>
      grant.clientId === clientId &&
      (grant.metadata as { projectId?: string } | null)?.projectId === projectId,
  );
}

/**
 * Walks the user's grants and revokes the ones a predicate picks out.
 *
 * The walk is the same whether one client on one project is being revoked or
 * the whole account is going away, and it is the part with the cursor to get
 * right, so it lives once. Only the predicate differs.
 */
async function revokeGrants(
  env: Env,
  userId: string,
  matches: (grant: { clientId: string; metadata: unknown }) => boolean,
): Promise<void> {
  try {
    let cursor: string | undefined;

    do {
      const page = await env.OAUTH_PROVIDER.listUserGrants(userId, {
        ...(cursor ? { cursor } : {}),
      });

      for (const grant of page.items) {
        if (!matches(grant)) continue;
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
 * Unregisters the OAuth client itself, once nothing points at it any more.
 *
 * Clients are global objects: one registration can be shared by several
 * accounts. So this refuses every case that is knowably shared — a metadata
 * document, whose id is a URL published by the client's author; Exeora's own
 * CLI and dashboard; and any client another authorization still names, whoever
 * it belongs to.
 *
 * Call this only after the rows that pointed at the client are gone, since that
 * is what `stillAuthorized` reads.
 */
async function forgetOAuthClient(env: Env, clientId: string): Promise<void> {
  try {
    if (isMetadataDocumentClient(clientId)) return;
    if (await stillAuthorized(env, clientId)) return;

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
    endpoint: client.endpoint,
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

/** Rows per page. Small enough to render at once, large enough to fill a screen. */
const CALLS_PAGE_SIZE = 50;

/**
 * The audit log, paginated and filtered here rather than in the browser.
 *
 * Filtering used to happen in the dashboard over whatever one request returned,
 * which quietly meant "the most recent fifty" rather than "everything": a
 * filter that found nothing could not be told apart from one whose matches were
 * all just off the end.
 *
 * The cursor is `(createdAt, id)` rather than an offset, so rows arriving while
 * someone pages through do not shift the window and hide a row behind the seam.
 * `id` breaks ties, because two calls can land in the same millisecond and the
 * index orders by the timestamp alone.
 */
api.get("/api/tool-calls", async (c) => {
  const userId = c.get("userId");
  const cursor = parseCallsCursor(c.req.query("cursor"));

  const filters = [eq(schema.toolCalls.userId, userId)];

  const projectId = c.req.query("projectId");
  if (projectId) filters.push(eq(schema.toolCalls.projectId, projectId));

  const status = c.req.query("status");
  if (status === "ok" || status === "error") filters.push(eq(schema.toolCalls.status, status));

  const clientId = c.req.query("clientId");
  if (clientId) filters.push(eq(schema.toolCalls.clientId, clientId));

  if (cursor) {
    filters.push(
      or(
        lt(schema.toolCalls.createdAt, new Date(cursor.createdAt)),
        and(
          eq(schema.toolCalls.createdAt, new Date(cursor.createdAt)),
          lt(schema.toolCalls.id, cursor.id),
        ),
      ) as SQL,
    );
  }

  // One more than the page, so whether there is a next page is known without a
  // second count query. The extra row is dropped before answering.
  const rows = await db(c.env)
    .select()
    .from(schema.toolCalls)
    .where(and(...filters))
    .orderBy(desc(schema.toolCalls.createdAt), desc(schema.toolCalls.id))
    .limit(CALLS_PAGE_SIZE + 1)
    .all();

  const page = rows.slice(0, CALLS_PAGE_SIZE);
  const last = rows.length > CALLS_PAGE_SIZE ? page.at(-1) : undefined;

  return c.json({
    items: page.map((call) => ({
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
    cursor: last ? encodeCallsCursor(last.createdAt.getTime(), last.id) : null,
  });
});

/**
 * Calls waiting on someone to confirm them, across every machine.
 *
 * A fan-out rather than a table, because a pending approval lives for ninety
 * seconds inside the Durable Object that is already holding the caller's
 * request. Writing it to D1 would mean a row whose whole purpose is to be
 * deleted before anyone could page through it.
 *
 * The fan-out is bounded twice over: only machines that have been seen recently
 * can be holding one, and a person has a handful of machines. A machine that
 * has been asleep for a week is not asked.
 */
api.get("/api/approvals", async (c) => {
  const userId = c.get("userId");

  const seenSince = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

  const devices = await db(c.env)
    .select({ id: schema.devices.id, name: schema.devices.name })
    .from(schema.devices)
    .where(
      and(
        eq(schema.devices.userId, userId),
        isNull(schema.devices.revokedAt),
        gt(schema.devices.lastSeenAt, seenSince),
      ),
    )
    .all();

  const perDevice = await Promise.all(
    devices.map(async (device) => {
      try {
        const approvals = await c.env.DEVICE_RELAY.getByName(
          relayName(userId, device.id),
        ).listApprovals();

        return approvals.map((approval) => ({ ...approval, deviceName: device.name }));
      } catch {
        // One unreachable object must not empty the whole list: the other
        // machines may well have a question waiting.
        return [];
      }
    }),
  );

  // Oldest first, because the oldest is the one closest to expiring and so the
  // one the person needs to answer next.
  const items = perDevice.flat().sort((a, b) => a.requestedAt - b.requestedAt);

  return c.json({ items });
});

/**
 * Answers one, from the browser.
 *
 * The device is named by the caller rather than parsed out of the approval id.
 * Both the id and the device come from the listing above, so nothing is being
 * trusted that was not just handed out, and the id keeps no structure that a
 * later change would have to preserve.
 *
 * A miss answers 409 rather than 404: the usual reason is that the terminal got
 * there first, which is a race the person should see as one, not as a thing
 * that was never there.
 */
api.post(
  "/api/approvals/:id",
  zValidator("json", z.object({ deviceId: z.string(), approved: z.boolean() })),
  async (c) => {
    const userId = c.get("userId");
    const { deviceId, approved } = c.req.valid("json");

    // The device has to be the caller's, or an approval id plus a guessed
    // device id would reach into another account's relay.
    const device = await db(c.env)
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)))
      .get();

    if (!device) return c.json({ error: "not_found" }, 404);

    const answered = await c.env.DEVICE_RELAY.getByName(relayName(userId, deviceId)).answerApproval(
      c.req.param("id"),
      approved,
    );

    if (!answered) {
      return c.json({ error: "already_answered" }, 409);
    }

    return c.json({ ok: true });
  },
);

/** How long an audit row is kept. */
const CALLS_RETENTION_DAYS = 90;

/**
 * Rows deleted per statement, and statements per run.
 *
 * Bounded on both axes because a first run over a long backlog would otherwise
 * be one enormous delete. Anything left over is picked up by tomorrow's run,
 * which is fine: this is a retention policy, not an emergency.
 */
const PRUNE_BATCH = 1_000;
const PRUNE_MAX_BATCHES = 20;

/**
 * Drops audit rows past the retention window.
 *
 * Called from the scheduled handler rather than from a request. Nothing else
 * bounds this table: every tool call writes one row, and an agent working
 * through a repository writes hundreds a minute.
 */
export async function pruneToolCalls(env: Pick<Env, "DB">): Promise<number> {
  const cutoff = new Date(Date.now() - CALLS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const database = db(env);

  let deleted = 0;

  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
    // A subquery with its own LIMIT, because SQLite only supports
    // `DELETE ... LIMIT` when it is compiled with an option D1 does not enable.
    const doomed = database
      .select({ id: schema.toolCalls.id })
      .from(schema.toolCalls)
      .where(lt(schema.toolCalls.createdAt, cutoff))
      .limit(PRUNE_BATCH);

    const result = await database
      .delete(schema.toolCalls)
      .where(inArray(schema.toolCalls.id, doomed))
      .run();

    const count = result.meta.changes ?? 0;
    deleted += count;
    if (count < PRUNE_BATCH) break;
  }

  return deleted;
}

/**
 * The cursor is opaque to the client but deliberately not signed: it carries
 * nothing the caller does not already have, and every query it feeds is still
 * bounded by the caller's own user id. The worst a forged one can do is page
 * through their own rows in an odd order.
 */
function encodeCallsCursor(createdAt: number, id: string): string {
  return `${createdAt}.${id}`;
}

function parseCallsCursor(raw: string | undefined): { createdAt: number; id: string } | undefined {
  if (!raw) return undefined;

  const separator = raw.indexOf(".");
  if (separator < 1) return undefined;

  const createdAt = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isFinite(createdAt) || !id) return undefined;

  return { createdAt, id };
}

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
