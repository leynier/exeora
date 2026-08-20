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
  if (message.worktreeId && !executorState.capabilities.worktreeRouting) {
    settleCaller(
      socket,
      relayError(
        "WORKTREE_UNAVAILABLE",
        "The connected Exeora CLI does not support worktree routing. Upgrade it and reconnect.",
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
        worktreeId: message.worktreeId,
        worktreeSlug: message.worktreeSlug,
        action: message.action,
        issuedAt: message.issuedAt,
        expiresAt: message.expiresAt,
      }),
    );
  } catch {
    settleCaller(socket, offline("The connection to the device failed."));
  }
}
