import { ExeoraError } from "@exeora/protocol";
import { createCloudRoot } from "./cloud/location.js";
import "./env.js";
import { rootSelector } from "./location-roots.js";
import { locationNames, locationsOf } from "./locations.js";

/**
 * What a call to the project root is told when there is no machine to take it.
 *
 * Two ways to get here. The machine of the default location was revoked and
 * is still listed, so the project has a default that nothing answers at. Or
 * the project lives nowhere: its last machine was deleted, or the instance
 * that held its root on Exeora Cloud was destroyed. The first is for a person
 * to settle. The second settles itself when the project is on Exeora Cloud,
 * because asking for the root is what makes the instance.
 */

/** The default location's machine was removed. */
export async function defaultRemoved(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
  deviceId: string,
): Promise<ExeoraError> {
  const all =
    (await locationsOf(env, userId, [{ id: projectId, deviceId, localPath: "" }])).get(projectId) ??
    [];
  const others = all.filter((location) => !location.default && location.state !== "removed");
  // A copy that is ready has a root of its own, which is somewhere to work
  // even when the project has no workspace at all.
  const roots = others
    .filter((location) => location.deviceId !== null && location.status === "ready")
    .map((location) => `\`${rootSelector(location.slug)}\``);
  const reach =
    roots.length > 0
      ? `Pass ${roots.join(" or ")} as the workspace to work in the project root there, work in a workspace there`
      : "Work in a workspace there";
  return new ExeoraError(
    "LOCAL_EXECUTOR_OFFLINE",
    others.length > 0
      ? `The machine of this project's default location was removed. It still lives on: ${locationNames(others)}. ${reach}, or choose a new default location in the Exeora dashboard.`
      : "The machine this project lives on was removed. Register it again with `exeora connect --reset` and `exeora project add`.",
  );
}

/**
 * The project has no default location. On Exeora Cloud the instance for its
 * root is asked for here, and the caller is told to come back for it.
 */
export async function noDefault(
  env: Env,
  userId: string,
  projectId: string,
  deviceId: string,
): Promise<ExeoraError> {
  const all =
    (await locationsOf(env, userId, [{ id: projectId, deviceId, localPath: "" }])).get(projectId) ??
    [];
  if (!all.some((location) => location.kind === "cloud")) {
    return new ExeoraError(
      "LOCAL_EXECUTOR_OFFLINE",
      "This project lives nowhere at the moment: the last machine that held a copy of it was removed. Its owner gives it a place again from the Exeora dashboard, or with `exeora project add` in a checkout of it. Calling create_workspace with where set to cloud puts it on Exeora Cloud.",
    );
  }

  const root = await createCloudRoot(env, userId, projectId);
  if ("error" in root) {
    return new ExeoraError(
      "LOCAL_EXECUTOR_OFFLINE",
      `This project is on Exeora Cloud with no instance for its root, and one could not be made: ${refusal(root)}`,
    );
  }
  return new ExeoraError(
    "EXECUTOR_WAKING",
    "The instance for this project's root on Exeora Cloud had been destroyed, and another is being made. It takes about a minute: try again then.",
  );
}

function refusal(error: { error: string; message?: string; max?: number | null }): string {
  switch (error.error) {
    case "plan_limit":
      return `every instance of the plan is in use (${error.max ?? "the limit"}). Destroy one from the Exeora dashboard to make room.`;
    case "cloud_disabled":
      return "Exeora Cloud is switched off for this account.";
    case "credentials_unavailable":
      return "the token it clones with cannot be read.";
    default:
      return error.message ?? `${error.error}.`;
  }
}
