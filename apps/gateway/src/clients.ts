import {
  CLOSED_POLICY,
  CommandPolicy,
  DEFAULT_POLICY,
  HEARTBEAT_TIMEOUT_MS,
} from "@exeora/protocol";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import type { ClientEndpoint } from "./db/schema.js";
import "./env.js";
import { newId } from "./ids.js";

/**
 * Bookkeeping for the MCP clients authorized against a project.
 *
 * Two different notions of "who is calling" meet here. The OAuth client is the
 * registered application: it has a `client_name` from RFC 7591, it is what a
 * token is issued to, and it is what revocation acts on. MCP's own `clientInfo`
 * is what the software calls itself over the wire, and it carries a version.
 * Neither is reliably present on its own, so both are recorded and the display
 * side falls back from one to the other.
 *
 * Every function here is scoped by `userId` and none of them throws: the caller
 * is always in the middle of something that matters more than this record. The
 * one exception is `stillAuthorized`, and the reason it has to be is written
 * above it.
 */

/** Who made a call, as far as the gateway can tell. */
export interface CallerIdentity {
  clientId: string | undefined;
  clientName: string | undefined;
  mcp: McpClientInfo | undefined;
}

export interface McpClientInfo {
  name?: string;
  version?: string;
}

/**
 * Records that a client was just authorized against a project.
 *
 * Called from the one place that mints authorization codes, so it also runs on
 * re-approval: `revokedAt` is cleared, which is what makes passing the consent
 * screen again the way to undo a revocation. That is safe because the screen
 * names the project and the machine and cannot be reached without the user
 * clicking approve.
 */
export async function rememberAuthorization(
  env: Pick<Env, "DB">,
  entry: {
    userId: string;
    projectId: string;
    clientId: string;
    clientName: string | undefined;
    clientUri: string | undefined;
    /** Which URL the consent was given through. Defaults to the per-project one. */
    endpoint?: ClientEndpoint;
  },
): Promise<void> {
  const now = new Date();
  const endpoint = entry.endpoint ?? "project";

  await db(env)
    .insert(schema.projectClients)
    .values({
      id: newId("pcl"),
      userId: entry.userId,
      projectId: entry.projectId,
      clientId: entry.clientId,
      endpoint,
      clientName: entry.clientName ?? null,
      clientUri: entry.clientUri ?? null,
      authorizedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.projectClients.projectId,
        schema.projectClients.clientId,
        schema.projectClients.endpoint,
      ],
      set: {
        clientName: entry.clientName ?? null,
        clientUri: entry.clientUri ?? null,
        authorizedAt: now,
        revokedAt: null,
      },
    })
    .run();
}

/**
 * Revokes every account-endpoint project this client holds except the named
 * ones, which is what makes the consent screen's tick boxes the access list
 * rather than a way to only ever add.
 *
 * Revoked rather than deleted, for the same reason the dashboard revokes:
 * the row is what keeps the audit log readable, and taking it away would erase
 * the record of access that once existed.
 */
export async function revokeAccountProjectsExcept(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string; keep: readonly string[] },
): Promise<void> {
  // One statement, and the database decides which rows are going: reading them
  // back first only to name them again would be a second round trip for an
  // answer the `where` already expresses. `notInArray` is left out entirely for
  // an empty list, since a list nobody is keeping narrows nothing.
  const keep = [...new Set(entry.keep)];

  await db(env)
    .update(schema.projectClients)
    .set({ revokedAt: new Date() })
    .where(
      keep.length === 0
        ? accountScope(entry)
        : and(accountScope(entry), notInArray(schema.projectClients.projectId, keep)),
    )
    .run();
}

/** Every row a client still holds on the account endpoint. */
function accountScope(entry: { userId: string; clientId: string }) {
  return and(
    eq(schema.projectClients.userId, entry.userId),
    eq(schema.projectClients.clientId, entry.clientId),
    eq(schema.projectClients.endpoint, "account"),
    // A revoked row is a record of access that ended, so nothing after it
    // belongs to that row: writing there would date the revocation instead.
    isNull(schema.projectClients.revokedAt),
  );
}

/**
 * Records what a client calls itself, learned from the MCP handshake or the
 * per-request envelope.
 *
 * Only ever fills a row that authorization already created, and only with
 * values that are actually present, so a client that stops sending `clientInfo`
 * does not erase what we knew about it.
 */
export async function rememberMcpClient(
  env: Pick<Env, "DB">,
  entry: { userId: string; projectId: string; clientId: string; endpoint?: ClientEndpoint },
  info: McpClientInfo,
): Promise<void> {
  if (!info.name && !info.version) return;

  await db(env)
    .update(schema.projectClients)
    .set({
      ...(info.name ? { mcpName: info.name } : {}),
      ...(info.version ? { mcpVersion: info.version } : {}),
    })
    .where(scope(entry))
    .run();
}

/** Marks a client as having just been used, and fills in anything new it told us. */
export async function touchClient(
  env: Pick<Env, "DB">,
  entry: { userId: string; projectId: string; clientId: string; endpoint?: ClientEndpoint },
  info: McpClientInfo | undefined,
): Promise<void> {
  await db(env)
    .update(schema.projectClients)
    .set({
      lastUsedAt: new Date(),
      ...(info?.name ? { mcpName: info.name } : {}),
      ...(info?.version ? { mcpVersion: info.version } : {}),
    })
    .where(scope(entry))
    .run();
}

/**
 * The same, for a call on the account endpoint that named no project.
 *
 * `list_projects` is answered without touching any one project, so there is no
 * single row to mark. Every project this client reaches through the account URL
 * gets the timestamp, which is the honest reading: the client was used, and the
 * dashboard's question is when it was last heard from.
 */
export async function touchAccountClient(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
  info: McpClientInfo | undefined,
): Promise<void> {
  await db(env)
    .update(schema.projectClients)
    .set({
      lastUsedAt: new Date(),
      ...(info?.name ? { mcpName: info.name } : {}),
      ...(info?.version ? { mcpVersion: info.version } : {}),
    })
    .where(accountScope(entry))
    .run();
}

/**
 * What a client called itself in the account endpoint's handshake.
 *
 * Only the name, never `lastUsedAt`, for the same reason `rememberMcpClient`
 * leaves it alone on the other endpoint: opening a connection is not using it,
 * and stamping it here would report a client that has never made a call as
 * having just made one, on every project the connection covers.
 */
export async function rememberAccountMcpClient(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
  info: McpClientInfo,
): Promise<void> {
  if (!info.name && !info.version) return;

  await db(env)
    .update(schema.projectClients)
    .set({
      ...(info.name ? { mcpName: info.name } : {}),
      ...(info.version ? { mcpVersion: info.version } : {}),
    })
    .where(accountScope(entry))
    .run();
}

/**
 * Where a tool call should go, and whether the caller may still make it.
 *
 * One statement rather than two: the project lookup has to happen anyway, and
 * hanging the client's revocation off it makes the check free. Returns null
 * when the project does not exist or belongs to someone else, which the caller
 * must not tell apart.
 *
 * A caller with no client id always comes back allowed. That is correct: the
 * OAuth layer has already accepted the token, and there is no client here to
 * have revoked. It is forced rather than left to the join, which would
 * otherwise match on the empty string and inherit some unrelated row's state.
 */
export async function resolveTarget(
  env: Pick<Env, "DB">,
  entry: { userId: string; projectId: string; clientId: string | undefined },
): Promise<{
  deviceId: string;
  clientRevokedAt: Date | null;
  policy: CommandPolicy;
} | null> {
  const row = await db(env)
    .select({
      deviceId: schema.projects.deviceId,
      commandPolicy: schema.projects.commandPolicy,
      clientRevokedAt: schema.projectClients.revokedAt,
    })
    .from(schema.projects)
    .leftJoin(
      schema.projectClients,
      and(
        eq(schema.projectClients.projectId, schema.projects.id),
        eq(schema.projectClients.clientId, entry.clientId ?? ""),
        eq(schema.projectClients.endpoint, "project"),
      ),
    )
    .where(and(eq(schema.projects.id, entry.projectId), eq(schema.projects.userId, entry.userId)))
    .get();

  if (!row) return null;
  return {
    deviceId: row.deviceId,
    clientRevokedAt: entry.clientId ? row.clientRevokedAt : null,
    policy: parsePolicy(row.commandPolicy),
  };
}

/**
 * The same question on the account endpoint, where the answer is stricter.
 *
 * `resolveTarget` lets a caller through when no row matches, and it is right to:
 * a token for `/p/:id/mcp` is bound by audience to that one project, so the row
 * is bookkeeping and its absence means nothing. A token for `/mcp` is bound to
 * an endpoint that names no project, so nothing else in the request says which
 * projects it may reach. Here the row **is** the grant, and an inner join is the
 * difference: no row, no access.
 *
 * Null for a project that does not exist, belongs to someone else, was never
 * ticked on the consent screen, or has since been revoked. The caller must not
 * tell those apart.
 */
export async function resolveAccountTarget(
  env: Pick<Env, "DB">,
  entry: { userId: string; projectId: string; clientId: string },
): Promise<{ deviceId: string; policy: CommandPolicy } | null> {
  const row = await db(env)
    .select({
      deviceId: schema.projects.deviceId,
      commandPolicy: schema.projects.commandPolicy,
    })
    .from(schema.projects)
    .innerJoin(
      schema.projectClients,
      and(
        eq(schema.projectClients.projectId, schema.projects.id),
        eq(schema.projectClients.clientId, entry.clientId),
        eq(schema.projectClients.endpoint, "account"),
        isNull(schema.projectClients.revokedAt),
      ),
    )
    .where(and(eq(schema.projects.id, entry.projectId), eq(schema.projects.userId, entry.userId)))
    .get();

  if (!row) return null;
  return { deviceId: row.deviceId, policy: parsePolicy(row.commandPolicy) };
}

/** A project as the account endpoint describes it to an agent. */
export interface AccountProject {
  id: string;
  slug: string;
  name: string;
  machine: string;
  online: boolean;
}

/**
 * Every project this client reaches through the account URL.
 *
 * `online` comes from the device's own heartbeat column rather than from asking
 * each relay, which would be one Durable Object round trip per project to
 * answer a question the database already knows. `localPath` is deliberately not
 * selected: the gateway never sends a machine's own paths to a tool, and
 * listing projects is not the place to start.
 */
export async function accountProjects(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
): Promise<AccountProject[]> {
  const seenSince = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

  const rows = await db(env)
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      name: schema.projects.name,
      machine: schema.devices.name,
      lastSeenAt: schema.devices.lastSeenAt,
      deviceRevokedAt: schema.devices.revokedAt,
    })
    .from(schema.projectClients)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectClients.projectId))
    .innerJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
    .where(
      and(
        eq(schema.projectClients.userId, entry.userId),
        eq(schema.projectClients.clientId, entry.clientId),
        eq(schema.projectClients.endpoint, "account"),
        isNull(schema.projectClients.revokedAt),
      ),
    )
    .orderBy(schema.projects.name)
    .all();

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    machine: row.machine,
    online:
      row.deviceRevokedAt === null &&
      row.lastSeenAt !== null &&
      row.lastSeenAt.getTime() > seenSince.getTime(),
  }));
}

/**
 * The choice this client last made, and whether it still stands.
 *
 * Null means no choice was ever made. That is a different thing from a choice
 * whose project has since been revoked, and the two must not be collapsed: a
 * connection that never chose can be sent to its only project without surprising
 * anyone, while one that chose and lost it has an agent still believing it is
 * somewhere else. Sending that one anywhere silently is how a `write_file`
 * lands in the wrong repository.
 *
 * Keeping the row is what makes the difference knowable, which is why nothing
 * deletes it on revocation. Its cost is that re-granting the project makes the
 * choice stand again, and that is the right answer: it was the user's own last
 * explicit choice, and any call made while it was unreachable was refused, so
 * an agent that carried on has already been made to choose again.
 */
export async function activeProjectChoice(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
): Promise<{ projectId: string; reachable: boolean } | null> {
  const row = await db(env)
    .select({
      projectId: schema.activeProjects.projectId,
      grantedId: schema.projectClients.id,
    })
    .from(schema.activeProjects)
    .leftJoin(
      schema.projectClients,
      and(
        eq(schema.projectClients.projectId, schema.activeProjects.projectId),
        eq(schema.projectClients.clientId, schema.activeProjects.clientId),
        eq(schema.projectClients.endpoint, "account"),
        isNull(schema.projectClients.revokedAt),
      ),
    )
    .where(
      and(
        eq(schema.activeProjects.userId, entry.userId),
        eq(schema.activeProjects.clientId, entry.clientId),
      ),
    )
    .get();

  if (!row) return null;
  return { projectId: row.projectId, reachable: row.grantedId !== null };
}

/** Points a client at a project, or clears the pointer when given null. */
export async function setActiveProjectId(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string; projectId: string | null },
): Promise<void> {
  if (entry.projectId === null) {
    await db(env)
      .delete(schema.activeProjects)
      .where(
        and(
          eq(schema.activeProjects.userId, entry.userId),
          eq(schema.activeProjects.clientId, entry.clientId),
        ),
      )
      .run();
    return;
  }

  await db(env)
    .insert(schema.activeProjects)
    .values({
      userId: entry.userId,
      clientId: entry.clientId,
      projectId: entry.projectId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.activeProjects.userId, schema.activeProjects.clientId],
      set: { projectId: entry.projectId, updatedAt: new Date() },
    })
    .run();
}

/**
 * The stored policy.
 *
 * Two failures that look alike and must not behave alike. An empty column means
 * the project predates the setting and nobody has ever restricted it, so
 * `allow_all` is the truth. A column holding something this cannot read means a
 * policy was set and is now illegible, and the one answer that cannot be wrong
 * in a dangerous direction is to allow nothing until someone sets it again.
 *
 * Falling back to `allow_all` in both cases would mean a corrupt row quietly
 * lifts every restriction on a project, which is the failure a policy exists to
 * prevent.
 */
export function parsePolicy(stored: string | null): CommandPolicy {
  if (!stored) return DEFAULT_POLICY;

  try {
    const parsed = CommandPolicy.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : CLOSED_POLICY;
  } catch {
    return CLOSED_POLICY;
  }
}

/**
 * A client id that is a metadata document URL rather than an opaque
 * registration (RFC 9728 / CIMD).
 *
 * These are published by the client's author and shared by every user of that
 * software, so nothing about one account's use of it may delete it.
 */
export function isMetadataDocumentClient(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Whether anyone still has this client authorized against any project.
 *
 * Deliberately not scoped to one user. An OAuth client is a global object, and
 * a registration made through DCR can end up shared between accounts: two
 * people running the same application both authorize the same client id. If one
 * of them finishes with it, unregistering it would break the other, silently
 * and from the outside.
 *
 * The provider cannot answer this, since it offers no way to ask who holds a
 * grant for a client. This table can, because every authorization writes a row
 * here, which is what makes the cross-account case detectable at all.
 */
export async function stillAuthorized(env: Pick<Env, "DB">, clientId: string): Promise<boolean> {
  const row = await db(env)
    .select({ count: sql<number>`count(*)` })
    .from(schema.projectClients)
    .where(eq(schema.projectClients.clientId, clientId))
    .get();

  return (row?.count ?? 0) > 0;
}

function scope(entry: {
  userId: string;
  projectId: string;
  clientId: string;
  endpoint?: ClientEndpoint;
}) {
  return and(
    eq(schema.projectClients.userId, entry.userId),
    eq(schema.projectClients.projectId, entry.projectId),
    eq(schema.projectClients.clientId, entry.clientId),
    eq(schema.projectClients.endpoint, entry.endpoint ?? "project"),
  );
}
