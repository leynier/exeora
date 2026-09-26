import { encodeMessage } from "@exeora/protocol";
import {
  type ApprovalCallerState,
  type ApprovalView,
  attachmentOf,
  executorSocket,
  offline,
  relayError,
  settleCaller,
  type ToolCallerState,
} from "./relay-do-callers.js";
import type { CallerRequest } from "./relay-internal.js";

type ApprovalStart = Extract<CallerRequest, { type: "approval.start" }>;

/**
 * A question for the person, asked on the machine's terminal when it has one
 * and always visible on the dashboard. Needs a connected executor because the
 * question is about a call that is about to run there, but never wakes a
 * cloud machine: a cloud CLI has no terminal to ask at, so the dashboard is
 * the only place the answer can come from.
 */
export function handleApprovalCallerMessage(
  ctx: DurableObjectState,
  socket: WebSocket,
  state: ApprovalCallerState,
  message: ApprovalStart,
): void {
  if (message.id !== state.id || state.view !== undefined) return;
  if (message.expiresAt <= Date.now()) {
    settleCaller(socket, { type: "approval.result", outcome: "unanswered" });
    return;
  }

  const executor = executorSocket(ctx);
  const executorState = executor ? attachmentOf(executor) : null;
  if (!executor || executorState?.role !== "executor") {
    settleCaller(socket, offline("No Exeora CLI is connected for this project."));
    return;
  }

  const targetId = message.workspaceId;
  const targetSlug = message.workspaceSlug;
  const view: ApprovalView = {
    id: message.id,
    deviceId: executorState.deviceId,
    projectId: message.projectId,
    ...(targetId ? { workspaceId: targetId } : {}),
    ...(targetSlug ? { workspaceSlug: targetSlug } : {}),
    tool: message.tool,
    prompt: message.prompt,
    ...(message.clientName ? { clientName: message.clientName } : {}),
    requestedAt: message.requestedAt,
    expiresAt: message.expiresAt,
  };
  socket.serializeAttachment({ ...state, view } satisfies ApprovalCallerState);

  if (executorState.capabilities?.prompt) {
    try {
      executor.send(
        encodeMessage({
          type: "approval.request",
          id: message.id,
          projectId: message.projectId,
          workspaceId: targetId,
          workspaceSlug: targetSlug,
          tool: message.tool,
          prompt: message.prompt,
          client: message.client,
          expiresAt: message.expiresAt,
        }),
      );
    } catch {
      // The dashboard can still answer while the caller socket is alive.
    }
  }
}

type WorkspaceStart = Extract<CallerRequest, { type: "workspace.start" }>;

export function handleWorkspaceCallerMessage(
  ctx: DurableObjectState,
  socket: WebSocket,
  state: ToolCallerState,
  message: WorkspaceStart,
): void {
  if (message.requestId !== state.id || state.issuedAt !== undefined) return;
  if (message.expiresAt <= Date.now()) {
    settleCaller(socket, relayError("TOOL_TIMEOUT", "The workspace call expired before dispatch."));
    return;
  }
  const executor = executorSocket(ctx);
  const executorState = executor ? attachmentOf(executor) : null;
  if (!executor || executorState?.role !== "executor") {
    settleCaller(socket, offline("No Exeora CLI is connected for this project."));
    return;
  }
  if (!executorState.capabilities?.features?.includes("source-control-v1")) {
    settleCaller(socket, {
      type: "error",
      error: { code: "FORBIDDEN", message: "Update the Exeora CLI to use Source Control." },
    });
    return;
  }
  const targetId = message.workspaceId;
  const targetSlug = message.workspaceSlug;
  const supportsRouting = Boolean(executorState.capabilities?.workspaceRouting);
  if (targetId && !supportsRouting) {
    settleCaller(
      socket,
      relayError(
        "WORKSPACE_UNAVAILABLE",
        "The connected Exeora CLI does not support workspace routing. Upgrade it and reconnect.",
      ),
    );
    return;
  }
  socket.serializeAttachment({ ...state, issuedAt: message.issuedAt } satisfies ToolCallerState);
  try {
    executor.send(
      encodeMessage({
        type: "workspace.call",
        requestId: message.requestId,
        projectId: message.projectId,
        workspaceId: targetId,
        workspaceSlug: targetSlug,
        action: message.action,
        issuedAt: message.issuedAt,
        expiresAt: message.expiresAt,
      }),
    );
  } catch {
    settleCaller(socket, offline("The connection to the device failed."));
  }
}

type McpStart = Extract<CallerRequest, { type: "mcp.start" }>;

export function handleMcpCallerMessage(
  ctx: DurableObjectState,
  socket: WebSocket,
  state: ToolCallerState,
  message: McpStart,
): void {
  if (message.requestId !== state.id || state.issuedAt !== undefined) return;
  if (message.expiresAt <= Date.now()) {
    settleCaller(socket, relayError("TOOL_TIMEOUT", "The MCP call expired before dispatch."));
    return;
  }
  const executor = executorSocket(ctx);
  const executorState = executor ? attachmentOf(executor) : null;
  if (!executor || executorState?.role !== "executor") {
    settleCaller(socket, offline("No Exeora CLI is connected for this project."));
    return;
  }
  if (!executorState.capabilities?.features?.includes("mcp-proxy-v1")) {
    settleCaller(socket, {
      type: "error",
      error: { code: "FORBIDDEN", message: "Update the Exeora CLI to use MCP proxying." },
    });
    return;
  }
  if (message.workspaceId && !executorState.capabilities?.workspaceRouting) {
    settleCaller(
      socket,
      relayError(
        "WORKSPACE_UNAVAILABLE",
        "The connected Exeora CLI does not support workspace routing. Upgrade it and reconnect.",
      ),
    );
    return;
  }
  socket.serializeAttachment({ ...state, issuedAt: message.issuedAt } satisfies ToolCallerState);
  try {
    executor.send(
      encodeMessage({
        type: "mcp.call",
        requestId: message.requestId,
        projectId: message.projectId,
        workspaceId: message.workspaceId,
        workspaceSlug: message.workspaceSlug,
        server: message.server,
        tool: message.tool,
        arguments: message.arguments,
        client: message.client,
        policy: message.policy,
        issuedAt: message.issuedAt,
        expiresAt: message.expiresAt,
      }),
    );
  } catch {
    settleCaller(socket, offline("The connection to the device failed."));
  }
}

type ToolStart = Extract<CallerRequest, { type: "tool.start" }>;

export function handleToolCallerMessage(
  ctx: DurableObjectState,
  socket: WebSocket,
  state: ToolCallerState,
  message: ToolStart,
): void {
  if (message.requestId !== state.id || state.issuedAt !== undefined) return;
  if (message.expiresAt <= Date.now()) {
    settleCaller(socket, relayError("TOOL_TIMEOUT", "The tool call expired before dispatch."));
    return;
  }

  const executor = executorSocket(ctx);
  const executorState = executor ? attachmentOf(executor) : null;
  if (!executor || executorState?.role !== "executor") {
    settleCaller(socket, offline("No Exeora CLI is connected for this project."));
    return;
  }
  const targetId = message.workspaceId;
  const targetSlug = message.workspaceSlug;
  const supportsRouting = Boolean(executorState.capabilities?.workspaceRouting);
  if (targetId && !supportsRouting) {
    settleCaller(
      socket,
      relayError(
        "WORKSPACE_UNAVAILABLE",
        "The connected Exeora CLI does not support workspace routing. Upgrade it and reconnect.",
      ),
    );
    return;
  }

  socket.serializeAttachment({
    ...state,
    issuedAt: message.issuedAt,
  } satisfies ToolCallerState);
  try {
    executor.send(
      encodeMessage({
        type: "tool.call",
        requestId: message.requestId,
        projectId: message.projectId,
        workspaceId: targetId,
        workspaceSlug: targetSlug,
        tool: message.tool,
        arguments: message.arguments,
        client: message.client,
        policy: message.policy,
        issuedAt: message.issuedAt,
        expiresAt: message.expiresAt,
      }),
    );
  } catch {
    settleCaller(socket, offline("The connection to the device failed."));
  }
}
