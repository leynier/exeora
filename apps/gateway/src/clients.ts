import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
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
 * is always in the middle of something that matters more than this record.
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
  },
): Promise<void> {
  const now = new Date();

  await db(env)
    .insert(schema.projectClients)
    .values({
      id: newId("pcl"),
      userId: entry.userId,
      projectId: entry.projectId,
      clientId: entry.clientId,
      clientName: entry.clientName ?? null,
      clientUri: entry.clientUri ?? null,
      authorizedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.projectClients.projectId, schema.projectClients.clientId],
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
 * Records what a client calls itself, learned from the MCP handshake or the
 * per-request envelope.
 *
 * Only ever fills a row that authorization already created, and only with
 * values that are actually present, so a client that stops sending `clientInfo`
 * does not erase what we knew about it.
 */
export async function rememberMcpClient(
  env: Pick<Env, "DB">,
  entry: { userId: string; projectId: string; clientId: string },
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
  entry: { userId: string; projectId: string; clientId: string },
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
): Promise<{ deviceId: string; clientRevokedAt: Date | null } | null> {
  const row = await db(env)
    .select({
      deviceId: schema.projects.deviceId,
      clientRevokedAt: schema.projectClients.revokedAt,
    })
    .from(schema.projects)
    .leftJoin(
      schema.projectClients,
      and(
        eq(schema.projectClients.projectId, schema.projects.id),
        eq(schema.projectClients.clientId, entry.clientId ?? ""),
      ),
    )
    .where(and(eq(schema.projects.id, entry.projectId), eq(schema.projects.userId, entry.userId)))
    .get();

  if (!row) return null;
  return { deviceId: row.deviceId, clientRevokedAt: entry.clientId ? row.clientRevokedAt : null };
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

/** Whether the user still has this client authorized somewhere else. */
export async function usedElsewhere(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
): Promise<boolean> {
  const row = await db(env)
    .select({ count: sql<number>`count(*)` })
    .from(schema.projectClients)
    .where(
      and(
        eq(schema.projectClients.userId, entry.userId),
        eq(schema.projectClients.clientId, entry.clientId),
      ),
    )
    .get();

  return (row?.count ?? 0) > 0;
}

function scope(entry: { userId: string; projectId: string; clientId: string }) {
  return and(
    eq(schema.projectClients.userId, entry.userId),
    eq(schema.projectClients.projectId, entry.projectId),
    eq(schema.projectClients.clientId, entry.clientId),
  );
}
