import type { CloudInstance, LocalMachine, Machine, MachineProject } from "./api-projects.js";
import type { Project, ProjectLocation } from "./api-types.js";
import { cloudLocation, instancesOf } from "./projectModel.js";

/**
 * What is left of a project once something it lives on is gone.
 *
 * Every confirmation that says "this stays" or "this goes" asks here, so
 * they cannot disagree with each other, and the rule they share is the
 * gateway's. A project with a repository outlives every place it lives: it
 * keeps its address, its policy and its clients, and lives nowhere until it is
 * given a location again. A directory with no remote goes with its machine,
 * because nothing could clone it elsewhere. Only "Remove project" removes a
 * project.
 *
 * A location whose machine was removed is a record of where the project used
 * to be. It is listed, so it can be cleaned up, and it is never somewhere to
 * live.
 */

/** What a project keeps whatever happens to the places it lives. */
const KEEPS = "with its address, policy and clients";

/** The locations a project still lives in: all of them but the removed ones. */
export function standingLocations<Entry extends Pick<ProjectLocation, "state">>(
  project: { locations: readonly Entry[] } | undefined,
): Entry[] {
  return (project?.locations ?? []).filter((location) => location.state !== "removed");
}

/**
 * Whether a project is a repository, which can be cloned again anywhere, and
 * not a directory that exists on one machine only. A project on Exeora Cloud
 * is always one: Cloud has nothing to run but a clone.
 */
export function hasRepository(project: Pick<Project, "repoUrl" | "cloud">): boolean {
  return project.repoUrl !== null || project.cloud !== null;
}

/**
 * Whether a project has no place to live at all: no default machine, and no
 * location that still stands. One that is on Exeora Cloud with no instance is
 * not this. It has a place, which is at rest until the next call.
 */
export function livesNowhere(project: Pick<Project, "nowhere" | "locations">): boolean {
  return project.nowhere === true && standingLocations(project).length === 0;
}

/**
 * Whether every place the project still lives is Exeora Cloud. A laptop that
 * was removed does not make it live anywhere else.
 */
export function livesOnlyOnCloud(project: Pick<Project, "locations">): boolean {
  const standing = standingLocations(project);
  return standing.length > 0 && standing.every((location) => location.kind === "cloud");
}

/**
 * Whether a project is on its way out. One that lives only on Exeora Cloud and
 * was removed is gone once its instances are, a moment after it was asked for,
 * and is listed as leaving until then.
 *
 * A project whose root instance was destroyed is not leaving. It has no
 * default machine from that moment on, which is how the two are told apart
 * while the instance is still on its way out.
 */
export function isLeaving(
  project: Pick<Project, "id" | "locations" | "nowhere">,
  machines: readonly Machine[],
) {
  const instances = instancesOf(machines, project.id);
  return (
    project.nowhere !== true &&
    livesOnlyOnCloud(project) &&
    instances.length > 0 &&
    instances.every((instance) => instance.state === "removing")
  );
}

/**
 * Whether a location is the only place the project still lives. A location
 * that only records a removed machine is not a place it lives.
 */
export function isLastLocation(
  project: Pick<Project, "locations">,
  location: Pick<ProjectLocation, "id" | "state">,
): boolean {
  if (location.state === "removed") return false;
  return standingLocations(project).every((entry) => entry.id === location.id);
}

/**
 * Why a location cannot be removed, said before the gateway is asked. A
 * repository may lose the only place it lives, default or not, and is kept. A
 * directory with no remote may not: it is the copy on that machine and
 * nothing else, so it is removed by removing the project.
 */
export function removalBlocker(
  project: Pick<Project, "locations" | "repoUrl" | "cloud">,
  location: Pick<ProjectLocation, "id" | "default" | "state">,
) {
  if (isLastLocation(project, location)) {
    return hasRepository(project)
      ? null
      : "This project is a directory on this machine and lives nowhere else. Remove the project instead.";
  }
  if (!location.default) return null;
  const others = standingLocations(project).filter((entry) => entry.id !== location.id);
  return others.length > 0
    ? "Choose another default location before removing this one."
    : "This is the default location and the project has no other. Add a location and make it the default, then remove this one.";
}

/** What removing a location does to the project, as the confirmation opens. */
export function removalSentence(
  project: Pick<Project, "locations">,
  location: Pick<ProjectLocation, "id" | "kind" | "state">,
): string {
  const last = isLastLocation(project, location);
  const stays = `The project stays, ${KEEPS}, and lives nowhere until it is given a location.`;
  if (location.kind === "cloud") {
    return last
      ? `The project is taken off Exeora Cloud, the only place it lives. ${stays} This destroys:`
      : "The project is taken off Exeora Cloud and stays in its other locations. This destroys:";
  }
  return last
    ? `Exeora forgets that the project lives on this machine, the only place it lives. ${stays} This removes:`
    : "Exeora forgets that the project lives on this machine. This removes:";
}

/**
 * What destroying the instance of a project root does, for the confirmation.
 *
 * The instance goes and the project never does. What happens to the project
 * root depends on where else the project lives: a machine of the person's
 * takes over as the default location, and with none Exeora Cloud stays the
 * default with no instance until one is made again.
 */
export function destroySentence(
  instance: Pick<CloudInstance, "project">,
  project: Pick<Project, "locations"> | undefined,
): string {
  const lost = `This is the copy of ${instance.project.name} that Exeora Cloud runs. Anything on it that was not pushed is lost, because the instance is the only copy of that.`;
  if (!project) return `${lost} The project stays, ${KEEPS}.`;
  const elsewhere = standingLocations(project).some((location) => location.kind === "local");
  if (!elsewhere) {
    return `${lost} The project stays, ${KEEPS}. The next call to its root makes another instance, and so does Start instance on the project's page.`;
  }
  return cloudLocation(project)?.default
    ? `${lost} The project stays, ${KEEPS}, and its default location moves to one of your machines.`
    : `${lost} The project stays, ${KEEPS}, and keeps its other locations.`;
}

export interface DeletionImpact {
  /** Directories with no remote that live only here, and go with the machine. */
  deleted: MachineProject[];
  /** Have another machine to carry on from, which becomes the default if this one was. */
  surviving: MachineProject[];
  /**
   * Live on Exeora Cloud as well, where nothing runs the project root. They
   * stay there with no instance, and the next call to the root makes one.
   */
  resting: MachineProject[];
  /** Repositories that live only here. They stay, and live nowhere. */
  nowhere: MachineProject[];
}

/**
 * What deleting a machine does to each project it holds.
 *
 * Nothing with a repository is deleted. A project with another location that
 * has a machine keeps going there. One whose only other location is Exeora
 * Cloud holding workspaces alone stays on Cloud with no instance, and one
 * that lives only here stays and lives nowhere. What goes is a directory with
 * no remote, and a project the list does not know is taken for one: a warning
 * that was not needed costs less than a promise that was not kept.
 */
export function deletionImpact(
  machine: Pick<LocalMachine, "deviceId" | "projects">,
  projects: readonly Pick<Project, "id" | "locations" | "repoUrl" | "cloud">[],
): DeletionImpact {
  const impact: DeletionImpact = { deleted: [], surviving: [], resting: [], nowhere: [] };
  for (const held of machine.projects) {
    const project = projects.find((candidate) => candidate.id === held.projectId);
    const others = standingLocations(project).filter(
      (location) => location.deviceId !== machine.deviceId,
    );
    if (others.some((location) => location.deviceId !== null)) impact.surviving.push(held);
    else if (others.some((location) => location.kind === "cloud")) impact.resting.push(held);
    else if (project && hasRepository(project)) impact.nowhere.push(held);
    else impact.deleted.push(held);
  }
  return impact;
}
