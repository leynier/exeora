import { and, eq, isNull } from "drizzle-orm";
import { enqueueAuditDeletion } from "../audit-deletions.js";
import { setActiveProjectId } from "../client-targets.js";
import { isMetadataDocumentClient, stillAuthorized } from "../clients.js";
import { db, schema } from "../db/client.js";
import { getCliClientId, getDashboardClientId } from "../oauth/clients.js";

/**
 * Shared account and grant operations used by both the owner's API and the
 * administration panel. They live here rather than in the route file so the
 * admin router can call the same code without a circular import.
 */

export function relayName(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

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
export async function deleteAccount(env: Env, userId: string): Promise<void> {
  const database = db(env);

  const devices = await database
    .select({ id: schema.devices.id })
    .from(schema.devices)
    .where(eq(schema.devices.userId, userId))
    .all();

  for (const device of devices) {
    // Sequential rather than in parallel: each one is a call into a different
    // Durable Object, and there is no deadline pressure on a deletion.
    await env.DEVICE_RELAY.getByName(relayName(userId, device.id)).revoke();
  }

  await revokeGrants(env, userId, () => true);

  // Read before the delete, since afterwards there is nothing left to read.
  const authorized = await database
    .selectDistinct({ clientId: schema.projectClients.clientId })
    .from(schema.projectClients)
    .where(eq(schema.projectClients.userId, userId))
    .all();

  // Before the delete for the same reason, and one step further: the archive
  // outlives D1, so what the maintenance job needs is the id, recorded while
  // there is still a row that explains what it means.
  await enqueueAuditDeletion(env, "user", [userId]);

  await database.delete(schema.users).where(eq(schema.users.id, userId)).run();

  for (const client of authorized) {
    await forgetOAuthClient(env, client.clientId);
  }
}

/**
 * Soft-revokes a machine and closes its live socket.
 *
 * Returns false when the machine is missing or belongs to someone else.
 */
export async function revokeDevice(env: Env, userId: string, deviceId: string): Promise<boolean> {
  const result = await db(env)
    .update(schema.devices)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)))
    .run();

  if (result.meta.changes === 0) return false;

  await env.DEVICE_RELAY.getByName(relayName(userId, deviceId)).revoke();
  return true;
}

/**
 * Soft-revokes a project client row and drops the grants it was carrying.
 *
 * Returns false when the row is missing or belongs to someone else.
 */
export async function revokeClient(
  env: Env,
  userId: string,
  clientRowId: string,
): Promise<boolean> {
  const client = await db(env)
    .select()
    .from(schema.projectClients)
    .where(and(eq(schema.projectClients.id, clientRowId), eq(schema.projectClients.userId, userId)))
    .get();

  if (!client) return false;

  await db(env)
    .update(schema.projectClients)
    .set({ revokedAt: new Date() })
    .where(eq(schema.projectClients.id, client.id))
    .run();

  await revokeGrantsAfter(env, userId, client);
  return true;
}

/**
 * Drops whatever grants the row that was just revoked was carrying.
 *
 * The two endpoints need different answers because their grants mean different
 * things. A per-project grant names one project and does nothing else, so
 * revoking that project revokes the grant. An account grant names `/mcp`, which
 * every project on that connection shares, so taking one project away must
 * leave it alone; only the last one closes it.
 */
export async function revokeGrantsAfter(
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

/** Drops the grants a client holds for the account endpoint, and only those. */
export async function revokeAccountGrants(
  env: Env,
  userId: string,
  clientId: string,
): Promise<void> {
  await revokeGrants(
    env,
    userId,
    (grant) =>
      grant.clientId === clientId &&
      Array.isArray((grant.metadata as { projectIds?: unknown } | null)?.projectIds),
  );
}

/** Drops every grant this user holds for one client on one project. */
export async function revokeGrantsFor(
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
export async function revokeGrants(
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
export async function forgetOAuthClient(env: Env, clientId: string): Promise<void> {
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

export { setActiveProjectId };
