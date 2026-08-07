import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";

/**
 * What an MCP client is actually asking for.
 *
 * A token here is bound to one project's endpoint, and "Authorize Claude" says
 * nothing about which one. RFC 8707 carries that in the `resource` parameter,
 * which MCP clients send after reading the RFC 9728 metadata for the path they
 * found, so the consent screen can name the project and the machine instead of
 * leaving the reader to guess.
 */

export interface AuthTarget {
  project: string;
  machine: string;
  localPath: string;
}

/**
 * Which of the two endpoints an authorization is for.
 *
 * `project` binds a token to one project and needs nothing from the person
 * beyond yes or no. `account` binds it to `/mcp`, which names no project at
 * all, so the consent screen has to ask which projects it covers and the answer
 * becomes the access list.
 */
export type AuthScope = { kind: "project"; projectId: string } | { kind: "account" };

/**
 * What an MCP resource URL is asking for, or null.
 *
 * Deliberately strict about the shape: this decides what a consent screen
 * claims a token is for, and a loose match would let a request name one thing
 * and be told another. `/mcp` has to be exactly that, so a client asking for
 * `/mcp/anything` is not quietly read as the account endpoint.
 *
 * `resource` may legally arrive more than once, and the token's audience then
 * carries every value. A project's own URL therefore wins over `/mcp` no matter
 * which order they were sent in: a token whose audience still names
 * `/p/:id/mcp` is accepted there, where a missing `project_clients` row means
 * "allowed", so answering such a request with the account screen would consent
 * to one thing and hand out a token good for another. Deciding it here, rather
 * than from whichever value happened to come first, also keeps the screen the
 * user sees from being the client's to choose.
 */
export function authScopeFromResource(resource: string | string[] | undefined): AuthScope | null {
  const paths: string[] = [];

  for (const candidate of resource === undefined ? [] : [resource].flat()) {
    try {
      paths.push(new URL(candidate).pathname);
    } catch {
      // Not a URL. RFC 8707 allows other forms, but ours are always URLs.
    }
  }

  for (const path of paths) {
    const match = /^\/p\/([^/]+)\/mcp$/.exec(path);
    if (match?.[1]) return { kind: "project", projectId: match[1] };
  }

  return paths.includes("/mcp") ? { kind: "account" } : null;
}

/** The project id inside a per-project MCP resource URL, or null. */
export function projectIdFromResource(resource: string | string[] | undefined): string | null {
  const scope = authScopeFromResource(resource);
  return scope?.kind === "project" ? scope.projectId : null;
}

/**
 * Resolves the target for display, scoped to the signed-in user.
 *
 * Returns null rather than throwing when the project is unknown or belongs to
 * someone else: this is only ever used to label a screen, and naming another
 * account's project would leak it. Access itself is decided per call at the
 * MCP endpoint, which this does not touch.
 */
export async function resolveAuthTarget(
  env: Pick<Env, "DB">,
  resource: string | string[] | undefined,
  userId: string,
): Promise<AuthTarget | null> {
  const projectId = projectIdFromResource(resource);
  if (!projectId) return null;

  const row = await db(env)
    .select({
      project: schema.projects.name,
      localPath: schema.projects.localPath,
      machine: schema.devices.name,
    })
    .from(schema.projects)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();

  return row ?? null;
}

/** One project as the account consent screen offers it. */
export interface AccountTargetProject {
  id: string;
  project: string;
  machine: string;
  localPath: string;
  /** Whether this client already reaches it, so the box arrives ticked. */
  granted: boolean;
}

/**
 * Every project the user could hand to a client on the account endpoint.
 *
 * The whole list, not only what is already granted, because this screen is the
 * access list rather than a way to add to one: an unticked box that was ticked
 * before means "take that away", and a project missing from the screen entirely
 * could never be taken away or given.
 *
 * Scoped to the account endpoint when reading what is already granted. Access
 * given through a project's own URL is a different consent and does not arrive
 * here pre-ticked, which is what keeps unticking a box from revoking something
 * this screen never granted.
 */
export async function resolveAccountTarget(
  env: Pick<Env, "DB">,
  userId: string,
  clientId: string,
): Promise<AccountTargetProject[]> {
  const rows = await db(env)
    .select({
      id: schema.projects.id,
      project: schema.projects.name,
      localPath: schema.projects.localPath,
      machine: schema.devices.name,
      grantedAt: schema.projectClients.authorizedAt,
    })
    .from(schema.projects)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
    .leftJoin(
      schema.projectClients,
      and(
        eq(schema.projectClients.projectId, schema.projects.id),
        eq(schema.projectClients.clientId, clientId),
        eq(schema.projectClients.endpoint, "account"),
        isNull(schema.projectClients.revokedAt),
      ),
    )
    .where(eq(schema.projects.userId, userId))
    .orderBy(schema.projects.name)
    .all();

  return rows.map(({ grantedAt, ...rest }) => ({ ...rest, granted: grantedAt !== null }));
}

/** Narrows a list of project ids to the ones this user owns, keeping order. */
export async function ownedProjectIds(
  env: Pick<Env, "DB">,
  userId: string,
  candidates: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(candidates)];
  if (wanted.length === 0) return [];

  // Asked about the ids in hand rather than by reading the whole account back:
  // the answer is the intersection either way, and the account with the most
  // projects is exactly the one that should not pay for a list it never sent.
  const rows = await db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), inArray(schema.projects.id, wanted)))
    .all();

  const owned = new Set(rows.map((row) => row.id));
  return wanted.filter((id) => owned.has(id));
}
