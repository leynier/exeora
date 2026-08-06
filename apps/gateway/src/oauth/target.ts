import { and, eq } from "drizzle-orm";
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
 * The project id inside an MCP resource URL, or null.
 *
 * Deliberately strict about the shape: this decides what a consent screen
 * claims a token is for, and a loose match would let a request name one thing
 * and be told another.
 */
export function projectIdFromResource(resource: string | string[] | undefined): string | null {
  const candidates = resource === undefined ? [] : [resource].flat();

  for (const candidate of candidates) {
    let path: string;
    try {
      path = new URL(candidate).pathname;
    } catch {
      // Not a URL. RFC 8707 allows other forms, but ours are always URLs.
      continue;
    }

    const match = /^\/p\/([^/]+)\/mcp$/.exec(path);
    if (match?.[1]) return match[1];
  }

  return null;
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
