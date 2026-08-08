import { CLOSED_POLICY, CommandPolicy, DEFAULT_POLICY } from "@exeora/protocol";
import { and, eq, isNull, lt, notInArray, or, type SQL, sql } from "drizzle-orm";
import { observeD1 } from "./cost-metrics.js";
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
 *
 * Reading the other way round, from a call to the machine that serves it, is
 * `client-targets.ts`.
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

/** Dashboard presence is intentionally approximate, not a write per call. */
export const CLIENT_TOUCH_INTERVAL_MS = 15 * 60_000;

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
  await touchRows(env, scope(entry), info);
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
  await touchRows(env, accountScope(entry), info);
}

/**
 * The one debounced write both endpoints share.
 *
 * The row is only rewritten when the timestamp has actually gone stale or the
 * client renamed itself, so an account making thousands of calls an hour costs
 * a handful of writes rather than one per call.
 */
async function touchRows(
  env: Pick<Env, "DB">,
  rows: SQL | undefined,
  info: McpClientInfo | undefined,
): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - CLIENT_TOUCH_INTERVAL_MS);
  const result = await db(env)
    .update(schema.projectClients)
    .set({
      // Identity changes must not look like fresh usage.
      lastUsedAt: sql`case
        when ${schema.projectClients.lastUsedAt} is null
          or ${schema.projectClients.lastUsedAt} < ${cutoff.getTime()}
        then ${now.getTime()}
        else ${schema.projectClients.lastUsedAt}
      end`,
      ...(info?.name ? { mcpName: info.name } : {}),
      ...(info?.version ? { mcpVersion: info.version } : {}),
    })
    .where(
      and(
        rows,
        or(
          isNull(schema.projectClients.lastUsedAt),
          lt(schema.projectClients.lastUsedAt, cutoff),
          ...(info?.name ? [sql`${schema.projectClients.mcpName} IS NOT ${info.name}`] : []),
          ...(info?.version
            ? [sql`${schema.projectClients.mcpVersion} IS NOT ${info.version}`]
            : []),
        ),
      ),
    )
    .run();
  // One independent draw per call, not one per debounce bucket. A key that is
  // constant for fifteen minutes makes the sample all-or-nothing, so an unlucky
  // bucket emits a log line for every call inside it, which is the cost this
  // telemetry exists to avoid.
  observeD1(crypto.randomUUID(), "client.touch", result.meta);
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
