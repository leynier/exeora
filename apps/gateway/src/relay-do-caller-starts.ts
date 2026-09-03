import { encodeMessage } from "@exeora/protocol";
import {
  attachmentOf,
  executorSocket,
  offline,
  relayError,
  settleCaller,
  type ToolCallerState,
} from "./relay-do-callers.js";
import type { CallerRequest } from "./relay-internal.js";

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
