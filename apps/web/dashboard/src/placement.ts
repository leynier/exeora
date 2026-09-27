import { ApiError, errorText, type Project, type ProjectLocation, type User } from "./api.js";
import type { Machine } from "./api-projects.js";
import { cloudLocation, isOlderCli, localMachines, MIN_CLI_FOR_LOCATIONS } from "./projectModel.js";

/**
 * What can be put where, and what to say when it cannot.
 *
 * The gateway refuses what is not allowed, with a sentence. These say the same
 * sentence before the request is made, so a dialog can show why a choice is
 * closed instead of letting somebody press the button to find out.
 */

/**
 * What making a workspace in a location will do, and whether it can be asked
 * for at all. Said before the button is pressed, because the two kinds of
 * location cost very different things: a folder on a machine, or an instance
 * that counts against a limit.
 */
export function placement(
  location: Pick<ProjectLocation, "kind" | "name" | "state" | "status"> | null,
  user: Pick<User, "limits" | "usage"> | undefined,
): { sentence: string; progress: string; blocked: boolean } {
  if (!location || location.kind === "cloud") {
    const used = user?.usage.cloudMachines ?? 0;
    const max = user?.limits.maxCloudMachines ?? null;
    const usage = max === null ? `${used} in use` : `${used} of ${max} in use`;
    const adds = location ? "" : " The project is put on Exeora Cloud first.";
    if (max !== null && used >= max) {
      return {
        sentence: `Exeora Cloud has no room for another instance: ${usage}. Destroy one under Machines to make room.`,
        progress: "",
        blocked: true,
      };
    }
    return {
      sentence: `A new instance on Exeora Cloud, with a clone of its own.${adds} It counts against the limit: ${usage}.`,
      progress: "Asking Exeora Cloud for an instance…",
      blocked: false,
    };
  }

  if (location.state === "offline" || location.state === "removed") {
    return {
      sentence:
        location.state === "removed"
          ? `${location.name} was revoked, so nothing can be made there.`
          : `${location.name} is offline. Run \`exeora connect\` on it, then try again.`,
      progress: "",
      blocked: true,
    };
  }

  if (location.status !== "ready") {
    return {
      sentence: `${location.name} has no copy yet, so the repository is cloned there first. That can take a few minutes.`,
      progress: `Cloning the repository on ${location.name}…`,
      blocked: false,
    };
  }

  return {
    sentence: `A working copy of its own on ${location.name}, next to the project.`,
    progress: `Creating the workspace on ${location.name}…`,
    blocked: false,
  };
}

/**
 * What to say in place of a plan when a project has no location that can take
 * a workspace. One that lives nowhere says so, because that is the cause, and
 * both say what to do first.
 */
export function noPlacement(project: Pick<Project, "nowhere">): {
  sentence: string;
  progress: string;
  blocked: boolean;
} {
  return {
    sentence: project.nowhere
      ? "This project lives nowhere, so there is no place to make a workspace. Add a location first."
      : "This project has no location that can take a workspace. Add a location first.",
    progress: "",
    blocked: true,
  };
}

/**
 * Why Exeora Cloud would not start an instance, as a sentence to act on. The
 * gateway names the limit of the plan with a code and a number. The sentence
 * is the one the dialogs say before asking, so a refusal reads the same
 * whether it was seen coming or not.
 */
export function instanceRefusal(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === "plan_limit") {
    const max = typeof error.body?.max === "number" ? error.body.max : null;
    const usage = max === null ? "" : `: all ${max} of the plan are in use`;
    return `Exeora Cloud has no room for another instance${usage}. Destroy one under Machines to make room.`;
  }
  return errorText(error, fallback);
}

/** Why Exeora Cloud cannot take a new project right now, or null when it can. */
export function cloudBlocker(user: Pick<User, "cloudEnabled" | "limits" | "usage"> | undefined) {
  if (!user) return "Checking whether this account has Exeora Cloud…";
  if (!user.cloudEnabled) {
    return "Exeora Cloud is not enabled for this account. An administrator enables it.";
  }
  const max = user.limits.maxCloudMachines;
  if (max !== null && user.usage.cloudMachines >= max) {
    return `Every instance of the plan is in use: ${user.usage.cloudMachines} of ${max}. Destroy one under Machines to make room.`;
  }
  return null;
}

/** The value that stands for Exeora Cloud where a machine's id would be. */
export const CLOUD = "cloud";

/** A place the project could also live, and why not when it cannot. */
export interface LocationCandidate {
  /** The machine's id, or `cloud`. */
  value: string;
  name: string;
  state: string | null;
  /** Set when it is listed and cannot be chosen: the cause and the action. */
  blocked: string | null;
}

/**
 * The places a project is not in yet: the person's machines that still stand,
 * and Exeora Cloud. A machine whose CLI cannot clone is listed and not
 * offered, so it is clear why it is missing rather than that it is.
 */
export function locationCandidates(
  project: Pick<Project, "locations">,
  machines: readonly Machine[],
  user: Pick<User, "cloudEnabled"> | undefined,
): LocationCandidate[] {
  const taken = new Set(project.locations.map((location) => location.deviceId));
  const candidates: LocationCandidate[] = localMachines(machines)
    .filter((machine) => machine.state !== "removed" && !taken.has(machine.deviceId))
    .map((machine) => ({
      value: machine.deviceId,
      name: machine.name,
      state: machine.state,
      blocked: isOlderCli(machine.cliVersion, MIN_CLI_FOR_LOCATIONS)
        ? `Update the CLI on this machine. It has ${machine.cliVersion ?? "an unknown version"}, and cloning a project needs ${MIN_CLI_FOR_LOCATIONS} or newer.`
        : null,
    }));

  if (cloudLocation(project) === null) {
    candidates.push({
      value: CLOUD,
      name: "Exeora Cloud",
      state: null,
      blocked:
        user?.cloudEnabled === true
          ? null
          : "Exeora Cloud is not enabled for this account. An administrator enables it.",
    });
  }
  return candidates;
}
