import type { ExecutorCapabilities, ToolName } from "@exeora/protocol";
import { encodeMessage } from "@exeora/protocol";
import type { CallerResponse } from "./relay-internal.js";

/**
 * What the relay's sockets are, and the bookkeeping over them.
 *
 * A Durable Object cannot be split into two classes, but this half of it never
 * needed to be a class at all: every function here reads or writes socket
 * attachments and tags through `ctx`, and none of them touches D1, the
 * environment or any field of the object. Taking `ctx` as an argument says that
 * outright and leaves `relay-do.ts` holding the parts that are genuinely about
 * the connection's life cycle.
 *
 * The state itself lives in `serializeAttachment` rather than in memory, which
 * is what lets a machine sit connected all day without pinning the object: a
 * hibernated relay wakes with everything it needs written on the sockets.
 */

/** How a request to confirm a call ended. */
export type ApprovalOutcome = "approved" | "declined" | "unanswered";

/** A pending approval as the dashboard needs to show it. */
export interface ApprovalView {
  id: string;
  deviceId: string;
  projectId: string;
  worktreeId?: string;
  worktreeSlug?: string;
  tool: ToolName;
  prompt: string;
  clientName?: string;
  requestedAt: number;
  expiresAt: number;
}

export interface ExecutorSocketState {
  role: "executor";
  deviceId: string;
  /** True only for the executor whose validated hello most recently arrived. */
  active?: boolean;
  /** Absent for an executor that predates the field; read as the baseline. */
  capabilities?: ExecutorCapabilities;
}

export interface ToolCallerState {
  role: "tool" | "workspace";
  id: string;
  settled: boolean;
  issuedAt?: number;
}

export interface TerminalCallerState {
  role: "terminal";
  id: string;
  projectId: string;
  worktreeId?: string;
  worktreeSlug?: string;
  targetKey: string;
  settled: boolean;
  startedAt: number;
  lastActivityAt: number;
}

export interface ApprovalCallerState {
  role: "approval";
  id: string;
  settled: boolean;
  view?: ApprovalView;
}

export type SocketState =
  | ExecutorSocketState
  | ToolCallerState
  | ApprovalCallerState
  | TerminalCallerState;

export function attachmentOf(socket: WebSocket): SocketState | null {
  const attachment = socket.deserializeAttachment();
  return attachment ? (attachment as SocketState) : null;
}

export function callerTag(
  role: "tool" | "workspace" | "approval" | "terminal",
  id: string,
): string {
  return `${role}:${id}`;
}

export function relayError(
  code: "TOOL_TIMEOUT" | "WORKTREE_UNAVAILABLE",
  message: string,
): CallerResponse {
  return { type: "error", error: { code, message } };
}

export function offline(message: string): CallerResponse {
  return { type: "error", error: { code: "LOCAL_EXECUTOR_OFFLINE", message } };
}

export function executorSocket(ctx: DurableObjectState): WebSocket | undefined {
  const sockets = ctx.getWebSockets("executor");
  return (
    sockets.find((socket) => {
      const state = attachmentOf(socket);
      return state?.role === "executor" && state.active === true;
    }) ??
    sockets.find((socket) => {
      const state = attachmentOf(socket);
      return state?.role === "executor" && state.active !== false;
    })
  );
}

/**
 * Keep one routable CLI socket after a reconnect. Workerd may still list the
 * dead connection first, which would otherwise swallow calls until timeout.
 */
export function replaceOtherExecutors(ctx: DurableObjectState, current: WebSocket): void {
  for (const socket of ctx.getWebSockets("executor")) {
    if (socket === current) continue;
    const state = attachmentOf(socket);
    if (state?.role === "executor") {
      socket.serializeAttachment({ ...state, active: false } satisfies ExecutorSocketState);
    }
    try {
      socket.send(
        encodeMessage({
          type: "shutdown",
          reason: "This device connected through a newer Exeora CLI session.",
        }),
      );
    } catch {
      // A stale socket is exactly what this cleanup expects to find.
    }
    try {
      socket.close(1008, "executor replaced");
    } catch {
      // It may have finished closing between the list and this call.
    }
  }
}

/** Best-effort cancellation for a caller that is no longer listening. */
export function sendCancel(ctx: DurableObjectState, requestId: string): void {
  try {
    executorSocket(ctx)?.send(encodeMessage({ type: "cancel", requestId }));
  } catch {
    // A disconnected executor has already lost the work.
  }
}

/**
 * Whether another routable executor is still attached.
 *
 * A reconnect marks the previous socket `active: false` before closing it. The
 * hibernation API may keep that stale socket in `getWebSockets()` until its close
 * event is delivered, so counting every attached socket can leave presence
 * recorded as connected after the replacement has also gone. Match
 * `executorSocket()` here and ignore executors that were explicitly replaced.
 */
export function hasOtherExecutor(ctx: DurableObjectState, closing: WebSocket): boolean {
  return ctx.getWebSockets("executor").some((socket) => {
    if (socket === closing) return false;
    const state = attachmentOf(socket);
    return state?.role === "executor" && state.active !== false;
  });
}

export function callerSocket(
  ctx: DurableObjectState,
  role: "tool" | "workspace" | "approval" | "terminal",
  id: string,
): WebSocket | undefined {
  return ctx.getWebSockets(callerTag(role, id)).find((socket) => {
    const state = attachmentOf(socket);
    return state?.role !== "executor" && state?.settled === false;
  });
}

export function settleCaller(socket: WebSocket, response: CallerResponse): void {
  const state = attachmentOf(socket);
  if (!state || state.role === "executor" || state.settled) return;
  socket.serializeAttachment({ ...state, settled: true } satisfies SocketState);
  try {
    socket.send(JSON.stringify(response));
  } catch {
    // The caller has already gone; its Worker owns the timeout/error.
  }
  socket.close(1000, "settled");
}

/** Drop dashboard terminal viewers without leaving them marked as live. */
export function failTerminalViewers(ctx: DurableObjectState, reason: string): void {
  for (const socket of ctx.getWebSockets("terminal")) {
    const state = attachmentOf(socket);
    if (state?.role !== "terminal") continue;
    socket.serializeAttachment({ ...state, settled: true } satisfies SocketState);
    try {
      socket.send(JSON.stringify({ type: "terminal.error", sessionId: state.id, message: reason }));
    } catch {
      // Browser is already gone.
    }
    socket.close(1011, "executor offline");
  }
}

export function failCallers(ctx: DurableObjectState, reason: string): void {
  for (const socket of ctx.getWebSockets("tool")) {
    settleCaller(socket, offline(reason));
  }
  for (const socket of ctx.getWebSockets("workspace")) {
    settleCaller(socket, offline(reason));
  }
  failTerminalViewers(ctx, reason);
  for (const socket of ctx.getWebSockets("approval")) {
    const state = attachmentOf(socket);
    if (state?.role === "approval") {
      settleCaller(socket, { type: "approval.result", outcome: "unanswered" });
      resolveTerminalApproval(ctx, state.id);
    }
  }
}

export function settleApproval(
  ctx: DurableObjectState,
  id: string,
  outcome: ApprovalOutcome,
): boolean {
  const caller = callerSocket(ctx, "approval", id);
  if (!caller) return false;
  const state = attachmentOf(caller);
  if (state?.role !== "approval" || !state.view) return false;
  if (state.view.expiresAt <= Date.now()) {
    settleCaller(caller, { type: "approval.result", outcome: "unanswered" });
    resolveTerminalApproval(ctx, id);
    return false;
  }
  settleCaller(caller, { type: "approval.result", outcome });
  resolveTerminalApproval(ctx, id);
  return true;
}

export function resolveTerminalApproval(ctx: DurableObjectState, id: string): void {
  const executor = executorSocket(ctx);
  try {
    executor?.send(encodeMessage({ type: "approval.resolved", id }));
  } catch {
    // Best effort: the prompt goes away on its own deadline regardless.
  }
}
