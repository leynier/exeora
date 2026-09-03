import { ExeoraError, mcpPolicyAllows, mcpToolName, needsMcpApproval } from "@exeora/protocol";
import { describeMcpCall } from "./approval.js";
import { type AuditHandle, beginAudit } from "./audit.js";
import { resolveAccountTarget, resolveTarget } from "./client-targets.js";
import type { CallerIdentity } from "./clients.js";
import "./env.js";
import { relayName } from "./api/ops.js";
import { record } from "./dispatch.js";
import { resolveAccountProject } from "./dispatch-account.js";
import { newId } from "./ids.js";
import type { DispatchResult } from "./mcp.js";
import type { AccountDispatchResult } from "./mcp-account.js";
import { callRelayMcpTool, requestRelayApproval } from "./relay-client.js";

/**
 * The downstream-MCP half of `dispatch.ts`: the same road — resolve, policy,
 * approval, relay, audit row — for a call whose tool belongs to a server the
 * machine configured rather than to Exeora's own contract.
 *
 * Audit rows carry the republished name (`mcp__server__tool`) as their tool,
 * so the log answers "what ran" with the name the caller actually used.
 */

export async function dispatchMcpToDevice(
  env: Env,
  call: {
    userId: string;
    projectId: string;
    server: string;
    tool: string;
    args: unknown;
    /** Whether the server claimed the tool changes nothing. */
    readOnlyHint: boolean | undefined;
    caller: CallerIdentity;
    approved: boolean;
    canElicit: boolean;
    signal?: AbortSignal | undefined;
    endpoint?: "project" | "account";
  },
): Promise<DispatchResult> {
  const { userId, projectId, server, tool, args, caller, signal } = call;
  const name = mcpToolName(server, tool);
  const endpoint = call.endpoint ?? "project";

  // On the account endpoint the caller has been checked against the access
  // list already; this resolves the device and the policy. `resolveTarget`
  // would let an unknown client through, which is right for a token bound to
  // one project's URL and wrong here, where the client is the whole access
  // list — the same reasoning as `dispatchToDevice`.
  const project =
    endpoint === "account"
      ? caller.clientId
        ? await resolveAccountTarget(env, { userId, projectId, clientId: caller.clientId })
        : null
      : await resolveTarget(env, { userId, projectId, clientId: caller.clientId });
  if (!project) {
    throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  }
  if ("clientRevokedAt" in project && project.clientRevokedAt) {
    throw new ExeoraError(
      "FORBIDDEN",
      "This application's access to the project was revoked. Authorize it again to restore it.",
    );
  }

  // The `tools` allow list is not consulted here, only the mode: that list is a
  // list of Exeora's own tool names and cannot name a downstream one, and the
  // machine's MCP configuration is the decision about which servers exist.
  const verdict = mcpPolicyAllows(project.policy, call.readOnlyHint);

  // An elicitation is a protocol round trip, not a tool attempt, so like the
  // canonical path it neither writes an audit row nor consumes usage.
  if (
    verdict.allowed &&
    needsMcpApproval(project.policy, call.readOnlyHint) &&
    !call.approved &&
    call.canElicit
  ) {
    return { kind: "needs-approval", projectId };
  }

  let audit: AuditHandle;
  try {
    audit = await beginAudit(env, {
      userId,
      projectId,
      tool: name,
      caller,
      endpoint,
    });
  } catch {
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
      tool: name,
      caller,
      audit,
      status: "error",
      errorCode: error.code,
      endpoint,
    });
    throw error;
  }

  if (needsMcpApproval(project.policy, call.readOnlyHint) && !call.approved) {
    const outcome = await requestRelayApproval(
      env.DEVICE_RELAY.getByName(relayName(userId, project.deviceId)),
      {
        id: newId("apr"),
        projectId,
        tool: name,
        prompt: describeMcpCall(server, tool),
        clientName: caller.clientName ?? caller.mcp?.name,
        client: callerLabel(caller),
      },
    );

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
        tool: name,
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
    const value = await callRelayMcpTool(
      env.DEVICE_RELAY.getByName(relayName(userId, project.deviceId)),
      {
        requestId: newId("req"),
        projectId,
        server,
        tool,
        args,
        client: callerLabel(caller),
        signal,
      },
    );
    await record(env, {
      userId,
      projectId,
      tool: name,
      caller,
      audit,
      status: "ok",
      endpoint,
    });
    return { kind: "value", value };
  } catch (error) {
    await record(env, {
      userId,
      projectId,
      tool: name,
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
 * The account endpoint's version, where the project is resolved from the
 * client's access list rather than from the token's audience.
 *
 * Downstream tools are offered there only when the connection reaches exactly
 * one project, so the project named here — the one they were announced for —
 * is both unambiguous and already granted. Resolving it again through
 * `resolveAccountProject` is what gives the confirmation question the project's
 * slug, which a person approving on this URL needs to be told.
 */
export async function dispatchAccountMcpCall(
  env: Env,
  call: {
    userId: string;
    projectId: string;
    server: string;
    tool: string;
    args: unknown;
    readOnlyHint: boolean | undefined;
    caller: CallerIdentity;
    approved: boolean;
    canElicit: boolean;
    signal?: AbortSignal | undefined;
  },
): Promise<AccountDispatchResult> {
  const { userId, caller } = call;
  if (!caller.clientId) {
    throw new ExeoraError("FORBIDDEN", "This connection cannot be identified.");
  }

  const project = await resolveAccountProject(env, {
    userId,
    clientId: caller.clientId,
    named: call.projectId,
  });

  const result = await dispatchMcpToDevice(env, {
    ...call,
    projectId: project.id,
    approved: call.approved,
    endpoint: "account",
  });

  return result.kind === "needs-approval"
    ? {
        kind: "needs-approval",
        projectId: result.projectId,
        project: project.slug,
        ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}),
      }
    : result;
}

function callerLabel(
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
