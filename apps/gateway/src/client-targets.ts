import type { CommandPolicy } from "@exeora/protocol";
import { and, eq, isNull } from "drizzle-orm";
import { parsePolicy } from "./clients.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { isDeviceOnline, presenceCutoff } from "./presence.js";

/**
 * Where a call lands: which machine serves a project, whether the caller may
 * reach it, and which project a connection to the account URL is working in.
 *
 * Split from `clients.ts` because the questions are different ones. That file
 * records who a client is and what it was granted; this one answers, for a call
 * already in flight, where it goes. The two endpoints disagree about what an
 * absent grant means, and the reason is written above `resolveAccountTarget`.
 */

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
    .innerJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
    .leftJoin(
      schema.projectClients,
      and(
        eq(schema.projectClients.projectId, schema.projects.id),
        eq(schema.projectClients.clientId, entry.clientId ?? ""),
        eq(schema.projectClients.endpoint, "project"),
      ),
    )
    .where(
      and(
        eq(schema.projects.id, entry.projectId),
        eq(schema.projects.userId, entry.userId),
        isNull(schema.devices.revokedAt),
      ),
    )
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
    .innerJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
    .where(
      and(
        eq(schema.projects.id, entry.projectId),
        eq(schema.projects.userId, entry.userId),
        isNull(schema.devices.revokedAt),
      ),
    )
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
 * `online` comes from the device's own presence columns rather than from asking
 * each relay, which would be one Durable Object round trip per project to
 * answer a question the database already knows. `localPath` is deliberately not
 * selected: the gateway never sends a machine's own paths to a tool, and
 * listing projects is not the place to start.
 */
export async function accountProjects(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
): Promise<AccountProject[]> {
  const cutoff = presenceCutoff();

  const rows = await db(env)
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      name: schema.projects.name,
      machine: schema.devices.name,
      lastSeenAt: schema.devices.lastSeenAt,
      disconnectedAt: schema.devices.disconnectedAt,
      revokedAt: schema.devices.revokedAt,
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
        isNull(schema.devices.revokedAt),
      ),
    )
    .orderBy(schema.projects.name)
    .all();

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    machine: row.machine,
    online: isDeviceOnline(row, cutoff),
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
      deviceRevokedAt: schema.devices.revokedAt,
    })
    .from(schema.activeProjects)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.activeProjects.projectId))
    .innerJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
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
  return {
    projectId: row.projectId,
    reachable: row.grantedId !== null && row.deviceRevokedAt === null,
  };
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
