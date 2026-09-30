import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { locationsOf } from "../locations.js";
import { MCP_SCOPES } from "./scopes.js";

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
  /** The default location, by name. */
  machine: string;
  localPath: string;
  /** `host/owner/name`, or null for a directory that has no remote. */
  repository: string | null;
  /** Every place the project lives, by name. A grant reaches all of them. */
  locations: string[];
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
 * Exactly one value, or nothing. `resource` may legally arrive more than once,
 * and the token's audience then carries every value, while a screen can only
 * ask about one: two project URLs would show the first and hand out a token
 * good for both. The audience is also matched by path prefix, so the origin on
 * its own, or `/p`, reaches every project while naming none. A request whose
 * audience is not precisely the one endpoint this returns is therefore read as
 * asking for nothing, and `refusedResource` turns that into a refusal.
 */
export function authScopeFromResource(resource: string | string[] | undefined): AuthScope | null {
  const values = resource === undefined ? [] : [resource].flat();
  const [only] = values;
  if (values.length !== 1 || only === undefined) return null;

  let path: string;
  try {
    path = new URL(only).pathname;
  } catch {
    // Not a URL. RFC 8707 allows other forms, but ours are always URLs.
    return null;
  }

  const match = /^\/p\/([^/]+)\/mcp$/.exec(path);
  if (match?.[1]) return { kind: "project", projectId: match[1] };

  return path === "/mcp" ? { kind: "account" } : null;
}

/**
 * Why this request cannot be authorized, or null when it can.
 *
 * A token carrying an MCP scope must be bound to the one endpoint its consent
 * screen was about. `/p/:id/mcp` lets a client with no `project_clients` row
 * through, because the audience is what binds the token to that project, so a
 * token with no audience, or a wider one, would run commands in projects nobody
 * was asked about. Exeora's own clients never receive an MCP scope and send no
 * resource, which is why this is decided by the scopes rather than the client.
 */
export function refusedResource(
  scopes: readonly string[],
  resource: string | string[] | undefined,
): string | null {
  if (!scopes.some((scope) => (MCP_SCOPES as readonly string[]).includes(scope))) return null;
  if (authScopeFromResource(resource)) return null;
  return (
    "This application did not name the one Exeora MCP endpoint it is connecting to, so there " +
    "is nothing specific to approve. Add it again using the MCP URL from your dashboard."
  );
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
      id: schema.projects.id,
      deviceId: schema.projects.deviceId,
      project: schema.projects.name,
      localPath: schema.projects.localPath,
      repository: schema.projects.repoKey,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
  if (!row) return null;

  const places = await placesOf(env, userId, [row]);
  return {
    project: row.project,
    localPath: row.localPath,
    repository: row.repository,
    ...(places.get(row.id) ?? { machine: "a machine that was removed", locations: [] }),
  };
}

/**
 * Where each project lives, in the words the consent screens use: the default
 * location's name, and the names of all of them. A grant is for the project,
 * so it reaches every one, and the person approving should see them all.
 */
async function placesOf(
  env: Pick<Env, "DB">,
  userId: string,
  projects: ReadonlyArray<{ id: string; deviceId: string; localPath: string }>,
): Promise<Map<string, { machine: string; locations: string[] }>> {
  const all = await locationsOf(env, userId, projects);
  return new Map(
    projects.map((project) => {
      const standing = (all.get(project.id) ?? []).filter(
        (location) => location.state !== "removed",
      );
      const chosen = standing.find((location) => location.default);
      return [
        project.id,
        {
          machine: chosen?.name ?? "a machine that was removed",
          locations: standing.map((location) => location.name),
        },
      ];
    }),
  );
}

/** One project as the account consent screen offers it. */
export interface AccountTargetProject {
  id: string;
  project: string;
  machine: string;
  localPath: string;
  repository: string | null;
  locations: string[];
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
      deviceId: schema.projects.deviceId,
      project: schema.projects.name,
      localPath: schema.projects.localPath,
      repository: schema.projects.repoKey,
      grantedAt: schema.projectClients.authorizedAt,
    })
    .from(schema.projects)
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

  const places = await placesOf(env, userId, rows);
  return rows.map(({ grantedAt, deviceId: _deviceId, ...rest }) => ({
    ...rest,
    ...(places.get(rest.id) ?? { machine: "a machine that was removed", locations: [] }),
    granted: grantedAt !== null,
  }));
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
