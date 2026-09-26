import {
  ExeoraError,
  type McpToolDescriptor,
  mcpPolicyAllows,
  needsMcpApproval,
} from "@exeora/protocol";
import { relayName } from "./api/ops.js";
import { describeMcpCall } from "./approval.js";
import { type AuditHandle, beginAudit } from "./audit.js";
import { resolveAccountTarget, resolveTarget, targetDevice } from "./client-targets.js";
import { callerLabel, record, resolveWorkspace } from "./dispatch.js";
import "./env.js";
import { newId } from "./ids.js";
import type { DispatchResult } from "./mcp.js";
import type { McpProxyCall } from "./mcp-proxy-tools.js";
import { callRelayMcpTool, requestRelayApproval } from "./relay-client.js";
import { decodeMcpCatalogs } from "./relay-mcp.js";

/**
 * The path a proxied MCP tool call takes to the machine.
 *
 * The same checks as a native tool, in the same order: the project and the
 * client are resolved and revocation is checked, the project's policy decides
 * whether the call may run and whether someone is asked first, and an audit
 * intent is durable before the device is touched.
 *
 * Whether the tool changes anything comes from the `readOnlyHint` in the
 * catalog the executor announced, never from the caller. The executor checks
 * the same hint against its own catalog, narrowed by the project's local
 * `exeora.toml`, before it calls the upstream server.
 */
export async function dispatchMcpToDevice(
  env: Env,
  call: McpProxyCall & {
    signal?: AbortSignal | undefined;
    endpoint?: "project" | "account";
  },
): Promise<DispatchResult> {
  const { userId, projectId, tool, args, caller, signal, endpoint = "project" } = call;
  // The account endpoint never falls back to `resolveTarget`, for the reason
  // `dispatchToDevice` gives: there the client is the whole access list.
  const project =
    endpoint === "account"
      ? caller.clientId
        ? await resolveAccountTarget(env, { userId, projectId, clientId: caller.clientId })
        : null
      : await resolveTarget(env, { userId, projectId, clientId: caller.clientId });
  if (!project) throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  if ("clientRevokedAt" in project && project.clientRevokedAt) {
    throw new ExeoraError(
      "FORBIDDEN",
      "This application's access to the project was revoked. Authorize it again to restore it.",
    );
  }

  const workspace = await resolveWorkspace(env, projectId, call.workspace);
  const deviceId = targetDevice(project, workspace);
  const relay = env.DEVICE_RELAY.getByName(relayName(userId, deviceId));
  // The descriptor the caller resolved came from the project machine's
  // catalog. A workspace on a machine of its own announced a catalog of its
  // own, and whether this tool changes anything is read from there: the
  // executor that runs it is the one whose hint counts.
  const descriptor =
    deviceId === project.deviceId ? tool : await descriptorOn(relay, projectId, tool);
  const approved = call.approved && call.approvedWorkspaceId === workspace?.id;
  const readOnlyHint = descriptor.annotations?.readOnlyHint;
  const verdict = mcpPolicyAllows(project.policy, readOnlyHint);
  const confirm = needsMcpApproval(project.policy, readOnlyHint) && !approved;

  if (verdict.allowed && confirm && call.canElicit) {
    return {
      kind: "needs-approval",
      projectId,
      ...(workspace ? { workspaceId: workspace.id, workspaceSlug: workspace.slug } : {}),
    };
  }

  let audit: AuditHandle;
  try {
    audit = await beginAudit(env, {
      userId,
      projectId,
      tool: tool.exposedName,
      caller,
      endpoint,
      ...(workspace ? { workspaceId: workspace.id, workspaceSlug: workspace.slug } : {}),
    });
  } catch (error) {
    console.error("audit outbox begin failed", error);
    throw new ExeoraError(
      "INTERNAL_ERROR",
      "The audit service is unavailable, so no MCP tool was run. Try again later.",
    );
  }

  const fail = async (error: ExeoraError): Promise<never> => {
    await record(env, {
      userId,
      projectId,
      tool: tool.exposedName,
      caller,
      audit,
      status: "error",
      errorCode: error.code,
      endpoint,
    });
    throw error;
  };

  if (!verdict.allowed) {
    return fail(
      new ExeoraError("FORBIDDEN", verdict.reason ?? "This project does not allow that."),
    );
  }

  if (confirm) {
    const outcome = await requestRelayApproval(relay, {
      id: newId("apr"),
      projectId,
      ...(workspace ? { workspaceId: workspace.id, workspaceSlug: workspace.slug } : {}),
      tool: tool.exposedName,
      prompt: `${describeMcpCall(tool.server, tool.name, args)}${workspace ? ` Workspace: ${workspace.slug}.` : ""}`,
      clientName: caller.clientName ?? caller.mcp?.name,
      client: callerLabel(caller),
    });
    if (outcome !== "approved") {
      return fail(
        outcome === "declined"
          ? new ExeoraError("APPROVAL_DECLINED", "The call was not approved.")
          : new ExeoraError(
              "APPROVAL_TIMEOUT",
              "This project asks for every change to be confirmed, and nobody answered. " +
                "Confirm it in the terminal running `exeora connect`, or in the Exeora dashboard.",
            ),
      );
    }
  }

  try {
    const value = await callRelayMcpTool(relay, {
      requestId: newId("req"),
      projectId,
      ...(workspace ? { workspaceId: workspace.id, workspaceSlug: workspace.slug } : {}),
      server: tool.server,
      tool: tool.name,
      args,
      client: callerLabel(caller),
      policy: project.policy,
      signal,
    });
    await record(env, {
      userId,
      projectId,
      tool: tool.exposedName,
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
      tool: tool.exposedName,
      caller,
      audit,
      status: "error",
      errorCode: error instanceof ExeoraError ? error.code : "INTERNAL_ERROR",
      endpoint,
    });
    throw error;
  }
}

/** The same upstream tool as one machine's catalog describes it, if it does. */
export function descriptorFromCatalog(
  catalogs: Record<string, McpToolDescriptor[]>,
  projectId: string,
  tool: Pick<McpToolDescriptor, "server" | "name">,
): McpToolDescriptor | undefined {
  return (catalogs[projectId] ?? []).find(
    (candidate) => candidate.server === tool.server && candidate.name === tool.name,
  );
}

async function descriptorOn(
  relay: DurableObjectStub<import("./relay-do.js").DeviceRelay>,
  projectId: string,
  tool: McpToolDescriptor,
): Promise<McpToolDescriptor> {
  const found = descriptorFromCatalog(
    decodeMcpCatalogs(await relay.mcpCatalogs([projectId])),
    projectId,
    tool,
  );
  if (!found) {
    throw new ExeoraError(
      "FORBIDDEN",
      `The workspace's machine does not offer ${tool.server}/${tool.name}.`,
    );
  }
  return found;
}
