import {
  ExeoraError,
  PROJECT_CLONE_FEATURE,
  type RepositoryRef,
  type ToolName,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { relayName } from "./api/ops.js";
import { explainFailure } from "./cloud/machine-errors.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import type { GitHubEnv } from "./github/app.js";
import { hasProjectCredential } from "./github/credentials.js";
import { newId } from "./ids.js";
import {
  findLocation,
  type LocationView,
  locationNames,
  locationsOf,
  putLocalLocation,
} from "./locations.js";
import { callRelayWorkspace } from "./relay-client.js";

/**
 * Which of a project's locations a workspace tool acts on.
 *
 * Every other tool goes where its workspace is, or to the default location
 * when it names none. The workspace tools are the ones that choose: making a
 * workspace is deciding where it will live, and listing checkouts is asking
 * one particular machine. `where` says which, and this is where it is read.
 */

export interface Placement {
  /** The machine the call goes to. Null for Exeora Cloud while it holds no machine to ask. */
  deviceId: string | null;
  /** Answered by the gateway, which is the one party that can make or destroy a machine. */
  cloud: boolean;
  /** The arguments as the machine is given them: without `where`, which it never sees. */
  args: unknown;
  /** The location, when the tool chose one rather than following a workspace. */
  location: LocationView | null;
}

interface ProjectRef {
  id: string;
  deviceId: string;
  localPath: string;
}

export async function placeWorkspaceTool(
  env: Pick<Env, "DB">,
  call: {
    userId: string;
    project: ProjectRef;
    tool: ToolName;
    args: unknown;
    workspace: { id: string; slug: string; deviceId: string | null } | null;
  },
): Promise<Placement> {
  const { where, args } = takeWhere(call.args);
  const follows = call.workspace ? (call.workspace.deviceId ?? call.project.deviceId) : undefined;

  // A workspace that is detached or removed is wherever it already is.
  if (call.tool === "detach_workspace" || call.tool === "remove_workspace") {
    const deviceId = follows ?? call.project.deviceId;
    return { deviceId, cloud: await isCloudMachine(env, deviceId), args, location: null };
  }

  const locations =
    (await locationsOf(env, call.userId, [call.project])).get(call.project.id) ?? [];

  if (where === undefined && follows !== undefined) {
    // `workspace` names the checkout to start from, and the new one is made
    // beside it: a worktree cannot be added from another machine.
    const beside = locations.find((location) => location.deviceId === follows) ?? null;
    return {
      deviceId: follows,
      cloud: beside?.kind === "cloud" || (await isCloudMachine(env, follows)),
      args,
      location: beside,
    };
  }

  const location = findLocation(locations, where);
  if (!location) {
    // `cloud` names a place every project with a repository can be put, so it
    // is not an unknown location even before the project is there.
    if (where?.trim().toLowerCase() === "cloud") {
      return { deviceId: null, cloud: true, args, location: null };
    }
    throw new ExeoraError(
      "INVALID_ARGUMENTS",
      where === undefined
        ? "This project has no default location to work in."
        : `This project does not live on "${where}". Its locations are: ${locationNames(locations)}.`,
    );
  }
  if (follows !== undefined && location.deviceId !== follows) {
    throw new ExeoraError(
      "INVALID_ARGUMENTS",
      `The workspace ${call.workspace?.slug} is not on ${location.slug}. Leave out where to make the new one beside it, or leave out workspace to start from the project root on ${location.slug}.`,
    );
  }
  if (location.state === "removed") {
    throw new ExeoraError(
      "WORKSPACE_UNAVAILABLE",
      `The machine ${location.name} was removed. The project's other locations are: ${locationNames(
        locations.filter((other) => other.state !== "removed"),
      )}.`,
    );
  }
  return { deviceId: location.deviceId, cloud: location.kind === "cloud", args, location };
}

function takeWhere(args: unknown): { where: string | undefined; args: unknown } {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { where: undefined, args };
  }
  const { where, ...rest } = args as Record<string, unknown>;
  return { where: typeof where === "string" ? where : undefined, args: rest };
}

export async function isCloudMachine(env: Pick<Env, "DB">, deviceId: string): Promise<boolean> {
  const row = await db(env)
    .select({ deviceId: schema.cloudMachines.deviceId })
    .from(schema.cloudMachines)
    .where(eq(schema.cloudMachines.deviceId, deviceId))
    .get();
  return row !== undefined;
}

/**
 * Makes sure a machine holds a copy of the project before a workspace is made
 * on it.
 *
 * Nothing to do for a location that is ready. One that was only chosen, or
 * whose clone failed, is asked to prepare: the CLI takes a checkout of the
 * same repository from the machine's projects folder or clones one there, and
 * says where it is. What it says is written down either way, so the dashboard
 * shows a clone that failed and why.
 */
export async function prepareLocation(
  env: Pick<Env, "DB" | "DEVICE_RELAY">,
  call: {
    userId: string;
    projectId: string;
    location: LocationView;
    signal?: AbortSignal | undefined;
  },
): Promise<void> {
  const { location } = call;
  if (location.kind !== "local" || location.deviceId === null) return;
  if (location.status === "ready") return;

  const project = await db(env)
    .select({
      slug: schema.projects.slug,
      name: schema.projects.name,
      repoUrl: schema.projects.repoUrl,
      defaultBranch: schema.projects.defaultBranch,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, call.projectId), eq(schema.projects.userId, call.userId)))
    .get();
  if (!project?.repoUrl) {
    throw new ExeoraError(
      "TOOL_FAILED",
      "This project has no repository to clone from, so it lives only where it was added.",
    );
  }

  const relay = env.DEVICE_RELAY.getByName(relayName(call.userId, location.deviceId));
  const capabilities = await relay.capabilities({ wake: true });
  if (!capabilities) {
    throw new ExeoraError(
      "LOCAL_EXECUTOR_OFFLINE",
      `${location.name} is not connected, so the project cannot be cloned there. Run \`exeora connect\` on it.`,
    );
  }
  if (!capabilities.features?.includes(PROJECT_CLONE_FEATURE)) {
    throw new ExeoraError(
      "TOOL_FAILED",
      `The Exeora CLI on ${location.name} is too old to clone a project. Run \`exeora upgrade\` there, or clone the repository by hand and run \`exeora project add\` in it.`,
    );
  }

  const repository: RepositoryRef = {
    url: project.repoUrl,
    slug: project.slug,
    name: project.name,
    ...(project.defaultBranch ? { defaultBranch: project.defaultBranch } : {}),
    credential: await cloneCredential(env, call.projectId),
  };
  const report = { userId: call.userId, projectId: call.projectId, deviceId: location.deviceId };

  await putLocalLocation(env, { ...report, status: "cloning" });
  try {
    const value = await callRelayWorkspace(relay, {
      requestId: newId("req"),
      projectId: call.projectId,
      action: { action: "project_prepare", repository },
      signal: call.signal,
    });
    if (value.kind !== "prepared") throw new Error("The machine answered something else.");
    await putLocalLocation(env, { ...report, status: "ready", localPath: value.localPath });
  } catch (error) {
    // A clone that outlives the call goes on, and the CLI reports how it
    // ended. Until then the location says it is being cloned, which is true.
    if (error instanceof ExeoraError && error.code === "TOOL_TIMEOUT") {
      throw new ExeoraError(
        "TOOL_TIMEOUT",
        `${location.name} is still cloning the repository. Call list_projects to see when it is ready, then try again.`,
      );
    }
    const said = error instanceof Error ? error.message : String(error);
    const failure = explainFailure(said);
    // What the machine said is already a sentence about its own clone, with
    // the cause and what to do there. It is kept; only the kind of failure is
    // read out of it, which is what decides the action a page offers.
    const message = error instanceof ExeoraError && said.length > 0 ? said : failure.message;
    await putLocalLocation(env, {
      ...report,
      status: "error",
      error: message,
      errorCode: failure.code,
    });
    throw new ExeoraError(
      error instanceof ExeoraError ? error.code : "TOOL_FAILED",
      `The project could not be cloned on ${location.name}. ${message}`,
    );
  }
}

/**
 * Whose credentials a clone should try first. The account's connection to
 * GitHub when the project is a repository it reaches, and otherwise what git
 * on the machine already has. Decided from the database alone: the token
 * itself is minted when git on the machine asks for it, not here.
 */
export async function cloneCredential(
  env: Pick<Env, "DB"> & GitHubEnv,
  projectId: string,
): Promise<RepositoryRef["credential"]> {
  return (await hasProjectCredential(env, projectId)) ? "exeora" : "machine";
}
