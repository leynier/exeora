import { ExeoraError, needsApproval, policyAllows, type ToolName } from "@exeora/protocol";
import { describeCall } from "./approval.js";
import { type AuditHandle, beginAudit, finishAudit } from "./audit.js";
import { resolveAccountTarget, resolveTarget } from "./client-targets.js";
import { type CallerIdentity, touchClient } from "./clients.js";
import "./env.js";
import { relayName } from "./api/ops.js";
import { newId } from "./ids.js";
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
    tool: ToolName;
    args: unknown;
    caller: CallerIdentity;
    /** Whether the user has confirmed this exact call, on a previous round. */
    approved: boolean;
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

  // Checked here as well as on the machine, and both are necessary. This is
  // the only side that holds the account's policy, and an older CLI would
  // ignore a field it does not know and run the command regardless; the
  // executor's own check is what covers a local `exeora.toml` and what still
  // stands if this one is wrong.
  const verdict = policyAllows(project.policy, tool, args);
  // Elicitation is a protocol round trip, not a tool attempt. The approved
  // second request is the one that receives an audit row and consumes usage.
  if (verdict.allowed && needsApproval(project.policy, tool) && !call.approved && call.canElicit) {
    return { kind: "needs-approval", projectId };
  }

  let audit: AuditHandle;
  try {
    audit = await beginAudit(env, { userId, projectId, tool, caller, endpoint });
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

  const requestId = newId("req");
  const relay = env.DEVICE_RELAY.getByName(relayName(userId, project.deviceId));

  // Asked before anything is dispatched, and asked here rather than in the MCP
  // layer because this is where the project's policy is known.
  if (needsApproval(project.policy, tool) && !call.approved) {
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
      tool,
      prompt: describeCall(tool, args),
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
    const value = await callRelayTool(relay, {
      requestId,
      projectId,
      tool,
      args,
      client: callerLabel(caller),
      // Sent even though it was just enforced, because the executor narrows it
      // with the project's own `exeora.toml` before running anything.
      policy: project.policy,
      signal,
    });
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

/**
 * What the executor is told about the caller, so `exeora connect` can name it.
 *
 * Only the two display fields, never the client id: the machine's terminal is
 * a different audience from the dashboard, and an opaque identifier there is
 * noise rather than information.
 */
function callerLabel(caller: CallerIdentity): { name?: string; version?: string } | undefined {
  const name = caller.clientName ?? caller.mcp?.name;
  const version = caller.mcp?.version;
  if (!name && !version) return undefined;
  return { ...(name ? { name } : {}), ...(version ? { version } : {}) };
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
