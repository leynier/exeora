import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import type { LocationKind, LocationStatus } from "./db/schema-locations.js";
import "./env.js";
import { newId } from "./ids.js";
import { pinLegacyWorkspacesStatement } from "./locations-default.js";
import { isNowhere, nowhereId } from "./nowhere.js";
import { isDeviceOnline, presenceCutoff } from "./presence.js";

/**
 * Where a project lives, read and changed.
 *
 * A project is one repository on as many machines as its owner likes, plus
 * Exeora Cloud. This is the one place that knows how those are listed, named
 * and chosen between; routing reads `projects.device_id` and a workspace's own
 * machine and never comes here on the way to a call.
 */

export const CLOUD_LOCATION_SLUG = "cloud";
export const CLOUD_LOCATION_NAME = "Exeora Cloud";

/** What a location is doing, in the one vocabulary every surface uses. */
export type LocationState =
  | "online"
  | "asleep"
  | "offline"
  | "setting up"
  | "failed"
  | "not cloned"
  | "no instance"
  | "removed";

export interface LocationView {
  id: string;
  kind: LocationKind;
  /** The machine, or null for Exeora Cloud while it holds no project root. */
  deviceId: string | null;
  /** The machine's name, or "Exeora Cloud". */
  name: string;
  /** What `where` takes: the machine's name as a slug, or `cloud`. */
  slug: string;
  localPath: string | null;
  status: LocationStatus;
  error: string | null;
  errorCode: string | null;
  /** Where a call that names no workspace lands. */
  default: boolean;
  online: boolean;
  state: LocationState;
  createdAt: number;
}

interface ProjectRef {
  id: string;
  deviceId: string;
  localPath: string;
}

/** A machine's name as a selector: lowercase letters, digits and hyphens. */
export function locationSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // `cloud` and `main` mean something already, so a machine called either
  // answers to a name that cannot be mistaken for them.
  if (slug === "" || slug === CLOUD_LOCATION_SLUG || slug === "main") {
    return `${slug || "machine"}-machine`;
  }
  return slug;
}

/**
 * Every location of these projects, oldest first, the default marked.
 *
 * A project made before locations existed, or by a gateway that did not know
 * them yet, has no row for the machine it is on. It is given one here, so the
 * answer is right whichever way the project came to be.
 *
 * A project that lost its last machine has no default among its machines. If
 * it is on Exeora Cloud, Cloud is its default all the same, holding no
 * instance: the next call to the project root is what makes one.
 */
export async function locationsOf(
  env: Pick<Env, "DB">,
  userId: string,
  projects: readonly ProjectRef[],
): Promise<Map<string, LocationView[]>> {
  const byProject = new Map<string, LocationView[]>(projects.map((project) => [project.id, []]));
  if (projects.length === 0) return byProject;
  const database = db(env);

  const read = () =>
    database
      .select({
        location: schema.projectLocations,
        deviceName: schema.devices.name,
        deviceKind: schema.devices.kind,
        lastSeenAt: schema.devices.lastSeenAt,
        disconnectedAt: schema.devices.disconnectedAt,
        revokedAt: schema.devices.revokedAt,
        machineStatus: schema.cloudMachines.status,
      })
      .from(schema.projectLocations)
      .leftJoin(schema.devices, eq(schema.devices.id, schema.projectLocations.deviceId))
      .leftJoin(
        schema.cloudMachines,
        eq(schema.cloudMachines.deviceId, schema.projectLocations.deviceId),
      )
      .where(
        and(
          eq(schema.projectLocations.userId, userId),
          inArray(
            schema.projectLocations.projectId,
            projects.map((project) => project.id),
          ),
        ),
      )
      .orderBy(schema.projectLocations.createdAt)
      .all();

  let rows = await read();
  const missing = projects.filter(
    (project) =>
      !isNowhere(project.deviceId) &&
      !rows.some(
        (row) =>
          row.location.projectId === project.id && row.location.deviceId === project.deviceId,
      ),
  );
  if (missing.length > 0) {
    await env.DB.batch(
      missing.map((project) => defaultLocationStatement(env, userId, project.id, project.deviceId)),
    );
    rows = await read();
  }

  const cutoff = presenceCutoff();
  const defaults = new Map(projects.map((project) => [project.id, project.deviceId]));
  for (const row of rows) {
    const list = byProject.get(row.location.projectId);
    if (!list) continue;
    const cloud = row.location.kind === "cloud";
    const chosen = defaults.get(row.location.projectId);
    const released = cloud && row.location.deviceId === null && isNowhere(chosen);
    const taken = new Set(list.map((entry) => entry.slug));
    const wanted = cloud ? CLOUD_LOCATION_SLUG : locationSlug(row.deviceName ?? "machine");
    let slug = wanted;
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${wanted}-${suffix}`;

    const online =
      row.lastSeenAt !== undefined && row.location.deviceId !== null
        ? isDeviceOnline(
            {
              revokedAt: row.revokedAt,
              disconnectedAt: row.disconnectedAt ?? null,
              lastSeenAt: row.lastSeenAt ?? null,
            },
            cutoff,
          )
        : false;

    list.push({
      id: row.location.id,
      kind: row.location.kind,
      deviceId: row.location.deviceId,
      name: cloud ? CLOUD_LOCATION_NAME : (row.deviceName ?? "machine"),
      slug,
      localPath: row.location.localPath,
      status: row.location.status,
      error: row.location.error,
      errorCode: row.location.errorCode,
      default: released || (row.location.deviceId !== null && row.location.deviceId === chosen),
      online,
      state: stateOf({
        cloud,
        released,
        online,
        revoked: Boolean(row.revokedAt),
        status: row.location.status,
        hasMachine: row.location.deviceId !== null,
        machineStatus: row.machineStatus ?? null,
      }),
      createdAt: row.location.createdAt.getTime(),
    });
  }
  return byProject;
}

function stateOf(input: {
  cloud: boolean;
  /** The default location, on Exeora Cloud, with no instance for the project root. */
  released: boolean;
  online: boolean;
  revoked: boolean;
  status: LocationStatus;
  hasMachine: boolean;
  machineStatus: string | null;
}): LocationState {
  if (input.revoked) return "removed";
  if (input.cloud) {
    if (input.released) return "no instance";
    // Cloud with no root machine holds only workspaces, each with a state of
    // its own; the location is there, and nothing of it is running.
    if (!input.hasMachine) return "asleep";
    if (input.machineStatus === "creating") return "setting up";
    if (input.machineStatus === "error") return "failed";
    return input.online ? "online" : "asleep";
  }
  if (input.status === "error") return "failed";
  if (input.status === "cloning") return "setting up";
  if (input.status === "pending") return input.online ? "not cloned" : "offline";
  return input.online ? "online" : "offline";
}

/** The row for the machine a project is on, for one that has none. */
export function defaultLocationStatement(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
  deviceId: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO project_locations (id, project_id, user_id, kind, device_id, local_path, status)
     SELECT ?1, p.id, p.user_id, d.kind, p.device_id, p.local_path, 'ready'
       FROM projects p
       JOIN devices d ON d.id = p.device_id
      WHERE p.id = ?2 AND p.user_id = ?3 AND p.device_id = ?4`,
  ).bind(newId("loc"), projectId, userId, deviceId);
}

/**
 * Says a machine holds, or is about to hold, a copy of the project.
 *
 * Written over an existing row rather than beside it: a machine is one
 * location of a project however many times it is named, and the newest word on
 * where the copy is and whether it is there wins.
 */
export async function putLocalLocation(
  env: Pick<Env, "DB">,
  entry: {
    userId: string;
    projectId: string;
    deviceId: string;
    localPath?: string | null | undefined;
    status: LocationStatus;
    error?: string | null | undefined;
    errorCode?: string | null | undefined;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO project_locations (id, project_id, user_id, kind, device_id, local_path, status, error, error_code)
     VALUES (?1, ?2, ?3, 'local', ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (project_id, device_id) DO UPDATE SET
       local_path = COALESCE(excluded.local_path, project_locations.local_path),
       status = excluded.status,
       error = excluded.error,
       error_code = excluded.error_code,
       updated_at = unixepoch() * 1000`,
  )
    .bind(
      newId("loc"),
      entry.projectId,
      entry.userId,
      entry.deviceId,
      entry.localPath ?? null,
      entry.status,
      entry.error ?? null,
      entry.errorCode ?? null,
    )
    .run();

  // A project that lives nowhere takes the first machine it is given as its
  // default. One that is on Exeora Cloud keeps Cloud, which was chosen.
  await env.DB.prepare(
    `UPDATE projects
        SET device_id = ?3, local_path = COALESCE(?4, local_path)
      WHERE id = ?1 AND user_id = ?2 AND device_id = ?5
        AND NOT EXISTS (
          SELECT 1 FROM project_locations l WHERE l.project_id = projects.id AND l.kind = 'cloud'
        )`,
  )
    .bind(
      entry.projectId,
      entry.userId,
      entry.deviceId,
      entry.localPath ?? null,
      nowhereId(entry.userId),
    )
    .run();

  // The default location's path is the one the project shows as its own.
  if (entry.localPath) {
    await db(env)
      .update(schema.projects)
      .set({ localPath: entry.localPath })
      .where(
        and(
          eq(schema.projects.id, entry.projectId),
          eq(schema.projects.userId, entry.userId),
          eq(schema.projects.deviceId, entry.deviceId),
        ),
      )
      .run();
  }
}

export type DefaultLocationError = "not_found" | "no_machine" | "machine_removed";

/**
 * Chooses where a call that names no workspace lands.
 *
 * Workspaces that predate locations are pinned to the machine they have been
 * on before the default moves away from it, in the same batch, so none of them
 * follows the default to a machine that never held it.
 */
export async function setDefaultLocation(
  env: Pick<Env, "DB">,
  userId: string,
  project: ProjectRef,
  location: Pick<LocationView, "id" | "deviceId" | "localPath" | "state">,
): Promise<true | DefaultLocationError> {
  if (location.deviceId === null) return "no_machine";
  if (location.state === "removed") return "machine_removed";
  if (location.deviceId === project.deviceId) return true;

  const results = await env.DB.batch([
    pinLegacyWorkspacesStatement(env, userId, project.deviceId),
    env.DB.prepare(
      `UPDATE projects SET device_id = ?3, local_path = COALESCE(?4, local_path)
        WHERE id = ?1 AND user_id = ?2
          AND EXISTS (SELECT 1 FROM project_locations l WHERE l.id = ?5 AND l.project_id = ?1)`,
    ).bind(project.id, userId, location.deviceId, location.localPath, location.id),
  ]);
  return (results.at(-1)?.meta.changes ?? 0) > 0 ? true : "not_found";
}

/**
 * Finds the location a caller named, by what it is called.
 *
 * Lenient on purpose: an agent read the name off `list_projects` and a person
 * typed it, so the machine's name, its slug, and `cloud` in any case all mean
 * what they look like. Undefined when nothing matches, which the caller turns
 * into an error that lists what would have.
 */
export function findLocation(
  locations: readonly LocationView[],
  where: string | undefined,
): LocationView | undefined {
  if (where === undefined) return locations.find((location) => location.default);
  const wanted = where.trim().toLowerCase();
  if (wanted === "") return locations.find((location) => location.default);
  return (
    locations.find((location) => location.slug === wanted) ??
    locations.find((location) => location.name.toLowerCase() === wanted) ??
    locations.find((location) => location.id === where || location.deviceId === where) ??
    (wanted === "exeora-cloud" || wanted === "exeora cloud"
      ? locations.find((location) => location.kind === "cloud")
      : undefined)
  );
}

/** The names a caller could have used, for the error that refuses the one it did. */
export function locationNames(locations: readonly LocationView[]): string {
  return locations.map((location) => location.slug).join(", ") || "none";
}
