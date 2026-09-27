import {
  ExeoraError,
  isWorkspaceToolName,
  needsApproval,
  policyAllows,
  type ToolName,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { describeCall } from "./approval.js";
import { type AuditHandle, beginAudit, finishAudit } from "./audit.js";
import { resolveAccountTarget, resolveTarget, targetDevice } from "./client-targets.js";
import { type CallerIdentity, touchClient } from "./clients.js";
import { answerCloudWorkspaceTool } from "./cloud/workspace-tools.js";
import { type Placement, placeWorkspaceTool, prepareLocation } from "./workspace-placement.js";
import "./env.js";
import { relayName } from "./api/ops.js";
import { db, schema } from "./db/client.js";
import { newId } from "./ids.js";
import {
  defaultRootSelector,
  ROOT_SELECTOR,
  resolveLocationRoot,
  rootLocation,
  rootSelector,
} from "./location-roots.js";
import { locationNames, locationsOf } from "./locations.js";
import type { DispatchResult } from "./mcp.js";
import { callRelayTool, requestRelayApproval } from "./relay-client.js";

/**
 * The path every tool call takes on its way to a machine.
 *
 * Both MCP endpoints end up here. What differs between them is resolved before
 * this point and arrives as `endpoint`: by the time a call gets this far the
 * project is settled and the remaining work, policy through approval through
 * relay through audit row, is the same either way.
 */

/**
 * Resolves the project, checks it belongs to the caller and that the caller's
 * client has not been revoked, and forwards the call to that project's device.
 *
 * The token is already bound to this project's resource identifier by the
 * OAuth layer, so this is the second of two independent checks rather than the
 * only one. The client check is a third: revoking deletes the OAuth grant, but
 * reading `revokedAt` in the same statement that resolves the project costs
 * nothing and closes the gap without depending on that having succeeded.
 */
export async function dispatchToDevice(
  env: Env,
  call: {
    userId: string;
    projectId: string;
    workspace?: string | undefined;
    tool: ToolName;
    args: unknown;
    caller: CallerIdentity;
    /** Whether the user has confirmed this exact call, on a previous round. */
    approved: boolean;
    approvedWorkspaceId?: string | undefined;
    /** Whether this client can be asked over MCP, rather than out of band. */
    canElicit: boolean;
    signal?: AbortSignal | undefined;
    /**
     * Which URL the call arrived on. Only the audit trail and the client's
     * bookkeeping care: by this point the project is resolved and everything
     * below runs the same either way.
     */
    endpoint?: "project" | "account";
  },
): Promise<DispatchResult> {
  const { userId, projectId, tool, args, caller, signal, endpoint = "project" } = call;

  // On the account endpoint the caller has already been checked against the
  // access list, which is the only thing that grants a project there; this
  // resolves the device and the policy for it.
  //
  // A call that arrived there without a client id resolves to nothing rather
  // than falling back to `resolveTarget`, which lets an unknown client through
  // by design. That default is right for a token bound to one project's URL and
  // wrong here, where the client is the whole access list: falling back would
  // turn "we cannot tell who this is" into "reach any project on the account".
  const project =
    endpoint === "account"
      ? caller.clientId
        ? await resolveAccountTarget(env, { userId, projectId, clientId: caller.clientId })
        : null
      : await resolveTarget(env, { userId, projectId, clientId: caller.clientId });

  // Same answer whether the project does not exist or belongs to someone else:
  // distinguishing them would make project ids enumerable.
  if (!project) {
    throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  }

  if ("clientRevokedAt" in project && project.clientRevokedAt) {
    throw new ExeoraError(
      "FORBIDDEN",
      "This application's access to the project was revoked. Authorize it again to restore it.",
    );
  }

  const workspace = await resolveWorkspace(env, projectId, call.workspace);
  const approved = call.approved && call.approvedWorkspaceId === workspaceKey(workspace);

  // Checked here as well as on the machine, and both are necessary. This is
  // the only side that holds the account's policy, and an older CLI would
  // ignore a field it does not know and run the command regardless; the
  // executor's own check is what covers a local `exeora.toml` and what still
  // stands if this one is wrong.
  const verdict = policyAllows(project.policy, tool, args);
  // Elicitation is a protocol round trip, not a tool attempt. The approved
  // second request is the one that receives an audit row and consumes usage.
  if (verdict.allowed && needsApproval(project.policy, tool) && !approved && call.canElicit) {
    return {
      kind: "needs-approval",
      projectId,
      ...approvalTarget(workspace),
    };
  }

  let audit: AuditHandle;
  try {
    audit = await beginAudit(env, {
      userId,
      projectId,
      tool,
      caller,
      endpoint,
      ...(await recordedIn(env, projectId, workspace)),
    });
  } catch (error) {
    console.error("audit outbox begin failed", error);
    throw new ExeoraError(
      "INTERNAL_ERROR",
      "The audit service is unavailable, so no tool was run. Try again later.",
    );
  }

  if (!verdict.allowed) {
    const error = new ExeoraError(
      "FORBIDDEN",
      verdict.reason ?? "This project does not allow that.",
    );
    await record(env, {
      userId,
      projectId,
      tool,
      caller,
      audit,
      status: "error",
      errorCode: error.code,
      endpoint,
    });
    throw error;
  }

  // Where the call goes. A workspace tool chooses among the project's
  // locations; everything else follows its workspace, or the default location
  // when it names none.
  let placement: Placement | undefined;
  try {
    placement = isWorkspaceToolName(tool)
      ? await placeWorkspaceTool(env, {
          userId,
          project: { id: projectId, deviceId: project.deviceId, localPath: "" },
          tool,
          args,
          workspace,
        })
      : undefined;
    if (!placement && !workspace && project.defaultRemoved) {
      throw await defaultRemoved(env, userId, projectId, project.deviceId);
    }
  } catch (error) {
    await record(env, {
      userId,
      projectId,
      tool,
      caller,
      audit,
      status: "error",
      errorCode: error instanceof ExeoraError ? error.code : "INTERNAL_ERROR",
      endpoint,
    });
    throw error;
  }

  const requestId = newId("req");
  // Cloud that holds no machine has nobody to ask; what needs a person, an
  // approval, goes to the default location, where somebody may be watching.
  const relay = env.DEVICE_RELAY.getByName(
    relayName(
      userId,
      placement ? (placement.deviceId ?? project.deviceId) : targetDevice(project, workspace),
    ),
  );

  // Asked before anything is dispatched, and asked here rather than in the MCP
  // layer because this is where the project's policy is known.
  if (needsApproval(project.policy, tool) && !approved) {
    // A client speaking 2026-07-28 is asked over MCP: the answer comes back on
    // a second round carrying a signed state bound to these arguments, which is
    // the best available answer because the person is already looking at the
    // conversation the call came from.
    // Everyone else is asked out of band. This used to refuse outright, which
    // made the setting decorative for exactly the clients most people use:
    // claude.ai and ChatGPT still speak the 2025 protocol today.
    const outcome = await requestRelayApproval(relay, {
      id: newId("apr"),
      projectId,
      ...routing(workspace),
      tool,
      prompt: `${describeCall(tool, args)}${workspace ? ` Workspace: ${workspace.slug}.` : ""}`,
      clientName: caller.clientName ?? caller.mcp?.name,
      client: callerLabel(caller),
    });

    if (outcome !== "approved") {
      const error =
        outcome === "declined"
          ? new ExeoraError("APPROVAL_DECLINED", "The call was not approved.")
          : new ExeoraError(
              "APPROVAL_TIMEOUT",
              "This project asks for every change to be confirmed, and nobody answered. " +
                "Confirm it in the terminal running `exeora connect`, or in the Exeora dashboard.",
            );

      await record(env, {
        userId,
        projectId,
        tool,
        caller,
        audit,
        status: "error",
        errorCode: error.code,
        endpoint,
      });
      throw error;
    }
  }

  try {
    // A cloud project answers its workspace tools here: a workspace there is a
    // machine to create or destroy, which no CLI can do. Every other project,
    // and every other tool, goes to the machine.
    const frame = {
      requestId,
      projectId,
      ...routing(workspace),
      tool,
      // A machine is never told `where`: by now it is the one that was chosen.
      args: placement ? placement.args : args,
      client: callerLabel(caller),
      // Sent even though it was just enforced, because the executor narrows it
      // with the project's own `exeora.toml` before running anything.
      policy: project.policy,
      signal,
    };
    // A machine that was chosen and has no copy yet gets one first.
    if (placement?.location && !placement.cloud && tool === "create_workspace") {
      await prepareLocation(env, { userId, projectId, location: placement.location, signal });
    }
    const value =
      (placement?.cloud
        ? await answerCloudWorkspaceTool(env, {
            userId,
            projectId,
            tool,
            args: placement.args,
            workspace: workspace?.id ? { id: workspace.id, slug: workspace.slug } : null,
            signal,
            issuedAt: Date.now(),
            // The machine applies the checkout's `exeora.toml` to the same
            // frame and answers with a verdict instead of running anything.
            // Cloud with no machine yet has no checkout to hold one.
            ...(placement.deviceId ? { askMachine: () => callRelayTool(relay, frame) } : {}),
          })
        : undefined) ?? (await callRelayTool(relay, frame));
    await record(env, { userId, projectId, tool, caller, audit, status: "ok", endpoint });
    return { kind: "value", value };
  } catch (error) {
    await record(env, {
      userId,
      projectId,
      tool,
      caller,
      audit,
      status: "error",
      errorCode: error instanceof ExeoraError ? error.code : "INTERNAL_ERROR",
      endpoint,
    });
    throw error;
  }
}

/** What a call to the project root is told when the default location's machine is gone. */
async function defaultRemoved(
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
 * What a call named as its workspace. `id` is null for the project root in a
 * location other than the default: it is a place a call can land, with a
 * machine of its own, and it is not a workspace row.
 */
export interface ResolvedWorkspace {
  id: string | null;
  slug: string;
  deviceId: string | null;
}

/** What the machine is told: a workspace by id and slug, and nothing for a root. */
export function routing(
  workspace: ResolvedWorkspace | null,
): { workspaceId: string; workspaceSlug: string } | Record<string, never> {
  return workspace?.id ? { workspaceId: workspace.id, workspaceSlug: workspace.slug } : {};
}

/**
 * What the audit trail keeps. A call to a project root is recorded with the
 * location it ran in, `main@laptop`, which is the one place the trail can say
 * where: the archive's columns are fixed, and the slug is one of them.
 */
export function recorded(
  workspace: ResolvedWorkspace | null,
  defaultRoot: string,
): { workspaceId?: string; workspaceSlug: string } {
  if (!workspace) return { workspaceSlug: defaultRoot };
  return { ...(workspace.id ? { workspaceId: workspace.id } : {}), workspaceSlug: workspace.slug };
}

/** `recorded`, asking what the default location is called only for a call that lands there. */
export async function recordedIn(
  env: Pick<Env, "DB">,
  projectId: string,
  workspace: ResolvedWorkspace | null,
) {
  return recorded(workspace, workspace ? "" : await defaultRootSelector(env, projectId));
}

/** What an approval is bound to, so one given for a place is not spent in another. */
export function workspaceKey(workspace: ResolvedWorkspace | null): string | undefined {
  return workspace ? (workspace.id ?? workspace.slug) : undefined;
}

export function approvalTarget(
  workspace: ResolvedWorkspace | null,
): { workspaceId: string; workspaceSlug: string } | Record<string, never> {
  const key = workspaceKey(workspace);
  return workspace && key ? { workspaceId: key, workspaceSlug: workspace.slug } : {};
}

/**
 * The workspace a call names, with the machine that serves it. Null is the
 * project root at the default location, which every project has.
 */
export async function resolveWorkspace(
  env: Pick<Env, "DB">,
  projectId: string,
  selector: string | undefined,
): Promise<ResolvedWorkspace | null> {
  if (!selector || selector.toLowerCase() === ROOT_SELECTOR) return null;
  const location = rootLocation(selector);
  if (location !== null) {
    const root = await resolveLocationRoot(env, projectId, location);
    // The default's root is `main` under another name, and is treated as it.
    return root.default ? null : { id: null, slug: root.slug, deviceId: root.deviceId };
  }
  const row = await db(env)
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      deviceId: schema.workspaces.deviceId,
      deviceRevokedAt: schema.devices.revokedAt,
    })
    .from(schema.workspaces)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.workspaces.deviceId))
    .where(
      and(
        eq(schema.workspaces.projectId, projectId),
        selector.startsWith("wsp_")
          ? eq(schema.workspaces.id, selector)
          : eq(schema.workspaces.slug, selector),
      ),
    )
    .get();
  if (!row) {
    throw new ExeoraError("UNKNOWN_WORKSPACE", "That workspace is not available in this project.");
  }
  // Never fall back to the project's machine: it holds a different checkout,
  // and running the call there would be quietly wrong rather than refused.
  if (row.deviceId !== null && row.deviceRevokedAt !== null) {
    throw new ExeoraError("WORKSPACE_UNAVAILABLE", "This workspace's machine was removed.");
  }
  return { id: row.id, slug: row.slug, deviceId: row.deviceId };
}

/**
 * What the executor is told about the caller.
 *
 * `name` and `version` are for the line `exeora connect` prints. `id` is the
 * OAuth client, used on the machine to bind a long-running process to whoever
 * started it. Absent when the gateway cannot name one, which is a real state:
 * the process is then unattributed rather than guessed into the next caller.
 */
export function callerLabel(
  caller: CallerIdentity,
): { id?: string; name?: string; version?: string } | undefined {
  const name = caller.clientName ?? caller.mcp?.name;
  const version = caller.mcp?.version;
  const id = caller.clientId;
  if (!id && !name && !version) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
  };
}

/** Audit row. Records what ran and how it ended, never arguments or output. */
export async function record(
  env: Env,
  entry: {
    userId: string;
    projectId: string;
    tool: string;
    caller: CallerIdentity;
    audit: AuditHandle;
    status: "ok" | "error";
    errorCode?: string;
    endpoint?: "project" | "account";
  },
): Promise<void> {
  const { caller } = entry;
  try {
    await finishAudit(env, entry.audit, {
      status: entry.status,
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    });
  } catch (error) {
    // The started row is already durable. The sweeper will close it as an
    // incomplete outcome; returning an error here could make a caller repeat a
    // command that did in fact run.
    console.error("audit outbox finish failed", error);
  }

  if (!caller.clientId) return;
  await touchClient(
    env,
    {
      userId: entry.userId,
      projectId: entry.projectId,
      clientId: caller.clientId,
      endpoint: entry.endpoint ?? "project",
    },
    caller.mcp,
  ).catch((error) => console.error("last-used bookkeeping failed", error));
}
