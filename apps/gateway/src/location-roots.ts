import { ExeoraError } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import "./env.js";
import { locationNames, locationsOf } from "./locations.js";

/**
 * The project root, in whichever location holds a copy of it.
 *
 * `main` is the root of the default location, and stays so. Every other
 * location that has a copy has a root too, the checkout its worktrees are made
 * from, and `main@desktop` names it. A slug cannot contain `@`, so the two
 * kinds of selector cannot be mistaken for each other.
 *
 * Nothing about the call changes on the machine: a root is reached by sending
 * no workspace at all, to the machine that holds it.
 */

export const ROOT_SELECTOR = "main";

/** What the root of a location is called: `main@laptop`. */
export function rootSelector(location: string): string {
  return `${ROOT_SELECTOR}@${location}`;
}

/** The location a selector names the root of, or null when it names none. */
export function rootLocation(selector: string | undefined): string | null {
  if (!selector) return null;
  const match = /^main@([a-z0-9][a-z0-9-]*)$/i.exec(selector.trim());
  return match?.[1] ? match[1].toLowerCase() : null;
}

/**
 * What the root of the default location is recorded as.
 *
 * The slug is the one `locationsOf` publishes, not one made again from the
 * machine's name: two machines whose names read the same are told apart by a
 * suffix there, and a call recorded without it would be filed under the other
 * machine, and lead there when the selector is used again.
 */
export async function defaultRootSelector(
  env: Pick<Env, "DB">,
  projectId: string,
): Promise<string> {
  const project = await projectOf(env, projectId);
  if (!project) return ROOT_SELECTOR;
  const all = (await locationsOf(env, project.userId, [project])).get(project.id) ?? [];
  const found = all.find((entry) => entry.default);
  return found ? rootSelector(found.slug) : ROOT_SELECTOR;
}

function projectOf(env: Pick<Env, "DB">, projectId: string) {
  return db(env)
    .select({
      id: schema.projects.id,
      userId: schema.projects.userId,
      deviceId: schema.projects.deviceId,
      localPath: schema.projects.localPath,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
}

export interface LocationRoot {
  /** The selector as it is recorded and shown: `main@desktop`. */
  slug: string;
  deviceId: string;
  /** True when it is the default location, which `main` alone also names. */
  default: boolean;
}

/**
 * Finds the root a selector names.
 *
 * Refused in words when the location is not one of the project's, when its
 * machine was removed, and when it holds no copy yet: a machine that was only
 * chosen has nothing at its root until its first workspace clones the project.
 */
export async function resolveLocationRoot(
  env: Pick<Env, "DB">,
  projectId: string,
  location: string,
): Promise<LocationRoot> {
  const project = await projectOf(env, projectId);
  if (!project) throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");

  const all = (await locationsOf(env, project.userId, [project])).get(project.id) ?? [];
  const standing = all.filter((entry) => entry.state !== "removed");
  const found = all.find((entry) => entry.slug === location);
  if (!found) {
    throw new ExeoraError(
      "UNKNOWN_WORKSPACE",
      `This project does not live on "${location}". Its locations are: ${locationNames(standing)}.`,
    );
  }
  if (found.state === "removed" || found.deviceId === null) {
    throw new ExeoraError(
      "WORKSPACE_UNAVAILABLE",
      found.kind === "cloud"
        ? "Exeora Cloud holds workspaces of this project and no copy of the project root. Work in one of them, or make Exeora Cloud the default location."
        : `The machine ${found.name} was removed. The project's locations are: ${locationNames(standing)}.`,
    );
  }
  if (found.kind === "local" && found.status !== "ready") {
    throw new ExeoraError(
      "WORKSPACE_UNAVAILABLE",
      `${found.name} has no copy of this project yet. Its first workspace there clones the repository: call create_workspace with where set to ${found.slug}.`,
    );
  }
  return { slug: rootSelector(found.slug), deviceId: found.deviceId, default: found.default };
}
