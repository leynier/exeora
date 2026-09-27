import type { CommandPolicy } from "@exeora/protocol";
import { and, eq, isNull } from "drizzle-orm";
import { parsePolicy } from "./clients.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { type LocationView, locationsOf } from "./locations.js";

/**
 * Where a call lands: which machine serves a project and whether the caller may
 * reach it.
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
  /**
   * Whether the default location's machine was removed. It used to make the
   * whole project unreachable; a project that lives in several places is
   * still reachable through the workspaces of the others, so only a call that
   * needs the default is refused, where the call is resolved.
   */
  defaultRemoved: boolean;
  clientRevokedAt: Date | null;
  policy: CommandPolicy;
} | null> {
  const row = await db(env)
    .select({
      deviceId: schema.projects.deviceId,
      deviceRevokedAt: schema.devices.revokedAt,
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
    .where(and(eq(schema.projects.id, entry.projectId), eq(schema.projects.userId, entry.userId)))
    .get();

  if (!row) return null;
  if (row.deviceRevokedAt !== null && !(await livesElsewhere(env, entry.projectId, row.deviceId))) {
    return null;
  }
  return {
    deviceId: row.deviceId,
    defaultRemoved: row.deviceRevokedAt !== null,
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
): Promise<{
  deviceId: string;
  defaultRemoved: boolean;
  policy: CommandPolicy;
} | null> {
  const row = await db(env)
    .select({
      deviceId: schema.projects.deviceId,
      deviceRevokedAt: schema.devices.revokedAt,
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
    .where(and(eq(schema.projects.id, entry.projectId), eq(schema.projects.userId, entry.userId)))
    .get();

  if (!row) return null;
  if (row.deviceRevokedAt !== null && !(await livesElsewhere(env, entry.projectId, row.deviceId))) {
    return null;
  }
  return {
    deviceId: row.deviceId,
    defaultRemoved: row.deviceRevokedAt !== null,
    policy: parsePolicy(row.commandPolicy),
  };
}

/**
 * Whether a project has a location with a machine of its own that still
 * stands, other than the one named: somewhere its default could move to.
 */
export async function livesOnAnotherMachine(
  env: Pick<Env, "DB">,
  projectId: string,
  deviceId: string,
): Promise<boolean> {
  const other = await env.DB.prepare(
    `SELECT 1 FROM project_locations l
       JOIN devices d ON d.id = l.device_id
      WHERE l.project_id = ?1 AND l.device_id != ?2 AND d.revoked_at IS NULL
      LIMIT 1`,
  )
    .bind(projectId, deviceId)
    .first();
  return other !== null;
}

/**
 * Whether a project is still somewhere once the machine named is gone. A
 * project whose only machine was removed is gone for every caller, at once;
 * one that lives elsewhere too has only lost its default.
 *
 * Exeora Cloud counts even when it holds no project root. Its workspaces are
 * machines of their own, which no location row names, and a project that has
 * them is reachable through them whatever became of the laptop.
 */
export async function livesElsewhere(
  env: Pick<Env, "DB">,
  projectId: string,
  deviceId: string,
): Promise<boolean> {
  if (await livesOnAnotherMachine(env, projectId, deviceId)) return true;
  const cloud = await env.DB.prepare(
    `SELECT 1 FROM cloud_projects c
      WHERE c.project_id = ?1
        AND NOT (c.deleting_at IS NOT NULL AND c.deleting_scope = 'project')
        AND EXISTS (
          SELECT 1 FROM project_locations l
           WHERE l.project_id = c.project_id AND l.kind = 'cloud'
             AND (l.device_id IS NULL OR l.device_id != ?2)
        )
      LIMIT 1`,
  )
    .bind(projectId, deviceId)
    .first();
  return cloud !== null;
}

/**
 * The machine a call lands on once its workspace is known.
 *
 * A workspace on the project's own machine is a worktree there and has no
 * device of its own; a cloud workspace is a machine of its own and is served
 * only there, because the project's machine holds a different checkout.
 */
export function targetDevice(
  project: { deviceId: string },
  workspace: { deviceId: string | null } | null | undefined,
): string {
  return workspace?.deviceId ?? project.deviceId;
}

/** A project as the account endpoint describes it to an agent. */
export interface AccountProject {
  id: string;
  slug: string;
  name: string;
  /** `host/owner/name`, or null for a directory with no remote. */
  repository: string | null;
  /** The default location, by name. */
  machine: string;
  /** Whether the default location can answer: online, or a cloud machine asleep. */
  online: boolean;
  locations: Array<{
    name: string;
    kind: LocationView["kind"];
    state: LocationView["state"];
    default: boolean;
  }>;
}

/** A location that answers a call made now: up, or asleep and woken by the call. */
export function answers(location: Pick<LocationView, "state">): boolean {
  return location.state === "online" || location.state === "asleep";
}

/**
 * Every project this client reaches through the account URL, with the places
 * each one lives.
 *
 * Presence comes from the devices' own columns rather than from asking each
 * relay, which would be one Durable Object round trip per machine to answer a
 * question the database already knows. Paths are deliberately left out: the
 * gateway never sends a machine's own paths to a tool, and listing projects is
 * not the place to start.
 *
 * A project is listed for as long as it lives somewhere. Losing the machine of
 * its default location does not hide it, because its workspaces elsewhere are
 * still reachable; a project whose every machine was removed is gone.
 */
export async function accountProjects(
  env: Pick<Env, "DB">,
  entry: { userId: string; clientId: string },
): Promise<AccountProject[]> {
  const rows = await db(env)
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      name: schema.projects.name,
      repoKey: schema.projects.repoKey,
      deviceId: schema.projects.deviceId,
      localPath: schema.projects.localPath,
    })
    .from(schema.projectClients)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectClients.projectId))
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

  const locations = await locationsOf(env, entry.userId, rows);

  return rows.flatMap((row) => {
    const all = (locations.get(row.id) ?? []).filter((location) => location.state !== "removed");
    if (all.length === 0) return [];
    const chosen = all.find((location) => location.default);
    return [
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        repository: row.repoKey,
        machine: chosen?.name ?? "removed",
        online: chosen ? answers(chosen) : false,
        locations: all.map((location) => ({
          name: location.slug,
          kind: location.kind,
          state: location.state,
          default: location.default,
        })),
      },
    ];
  });
}
