import type { LocalMachine, Machine, MachineProject } from "./api-projects.js";
import type { Project, ProjectLocation } from "./api-types.js";
import { instancesOf } from "./projectModel.js";

/**
 * What is left of a project once something it lives on is gone.
 *
 * Every confirmation that says "this survives" or "this goes" asks here, so
 * they cannot disagree with each other, and the rule they share is the
 * gateway's: a project lives where a location still stands. A location whose
 * machine was removed is a record of where the project used to be. It is
 * listed, so it can be cleaned up, and it is never somewhere to live.
 */

/** The locations a project still lives in: all of them but the removed ones. */
export function standingLocations<Entry extends Pick<ProjectLocation, "state">>(
  project: { locations: readonly Entry[] } | undefined,
): Entry[] {
  return (project?.locations ?? []).filter((location) => location.state !== "removed");
}

/**
 * Whether every place the project still lives is Exeora Cloud, so nothing of
 * it survives its instances. A laptop that was removed does not make it live
 * anywhere else.
 */
export function livesOnlyOnCloud(project: Pick<Project, "locations">): boolean {
  const standing = standingLocations(project);
  return standing.length > 0 && standing.every((location) => location.kind === "cloud");
}

/**
 * Whether a project is on its way out. One that lives only on Exeora Cloud is
 * gone once its instances are, a moment after it was asked for, and is listed
 * as leaving until then.
 */
export function isLeaving(
  project: Pick<Project, "id" | "locations">,
  machines: readonly Machine[],
) {
  const instances = instancesOf(machines, project.id);
  return (
    livesOnlyOnCloud(project) &&
    instances.length > 0 &&
    instances.every((instance) => instance.state === "removing")
  );
}

/**
 * Why a location cannot be removed, said before the gateway is asked. The
 * last place a project still lives is removed by removing the project, and a
 * location that only records a removed machine is not a place it lives.
 */
export function removalBlocker(
  project: Pick<Project, "locations">,
  location: Pick<ProjectLocation, "id" | "default">,
) {
  const others = standingLocations(project).filter((entry) => entry.id !== location.id);
  if (others.length === 0) {
    return "This is the only place the project lives. Remove the project instead.";
  }
  if (location.default) return "Choose another default location before removing this one.";
  return null;
}

export interface DeletionImpact {
  /** Live nowhere else that stands, and go with the machine. */
  deleted: MachineProject[];
  /** Have another machine, or an instance for the project root, to carry on from. */
  surviving: MachineProject[];
  /**
   * Live on Exeora Cloud as well, where nothing runs the project root. The
   * gateway starts an instance for it there and makes Cloud the default, and
   * refuses the whole deletion when it cannot.
   */
  moving: MachineProject[];
}

/**
 * What deleting a machine does to each project it holds.
 *
 * A project with another location that has a machine keeps going there. One
 * whose only other location is Exeora Cloud holding workspaces alone survives
 * too, and at a cost that has to be said: an instance is started for it.
 */
export function deletionImpact(
  machine: Pick<LocalMachine, "deviceId" | "projects">,
  projects: readonly Pick<Project, "id" | "locations">[],
): DeletionImpact {
  const impact: DeletionImpact = { deleted: [], surviving: [], moving: [] };
  for (const held of machine.projects) {
    const others = standingLocations(
      projects.find((candidate) => candidate.id === held.projectId),
    ).filter((location) => location.deviceId !== machine.deviceId);
    if (others.some((location) => location.deviceId !== null)) impact.surviving.push(held);
    else if (others.some((location) => location.kind === "cloud")) impact.moving.push(held);
    else impact.deleted.push(held);
  }
  return impact;
}
