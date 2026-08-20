import {
  APPROVAL_WAIT_MS,
  type CommandPolicy,
  ExeoraError,
  MAX_APPROVAL_PROMPT_LENGTH,
  RELAY_TIMEOUT_MS,
  type ToolName,
  type WorkspaceAction,
  type WorkspaceValue,
} from "@exeora/protocol";
import { observeRelayTermination } from "./cost-metrics.js";
import type { DeviceRelay } from "./relay-do.js";
import type { ApprovalOutcome } from "./relay-do-callers.js";
import { type CallerRequest, decodeCallerResponse } from "./relay-internal.js";

type RelayStub = DurableObjectStub<DeviceRelay>;

export async function callRelayWorkspace(
  relay: RelayStub,
  options: {
    requestId: string;
    projectId: string;
    worktreeId?: string | undefined;
    worktreeSlug?: string | undefined;
    action: WorkspaceAction;
    signal?: AbortSignal | undefined;
  },
): Promise<WorkspaceValue> {
  if (options.signal?.aborted) throw cancelled();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + RELAY_TIMEOUT_MS;
  const socket = await dial(relay, "workspace", options.requestId);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (answer: { value: WorkspaceValue } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      close(socket);
      if ("error" in answer) reject(answer.error);
      else resolve(answer.value);
    };
    const abort = () => {
      send(socket, { type: "cancel" });
      finish({ error: cancelled() });
    };
    const timer = setTimeout(
      () => {
        send(socket, { type: "cancel" });
        finish({
          error: new ExeoraError("TOOL_TIMEOUT", "The device did not answer before the deadline."),
        });
      },
      Math.max(0, expiresAt - Date.now()),
    );
    socket.addEventListener("message", (event) => {
      const response = decodeCallerResponse(String(event.data));
      if (response?.type === "workspace.result") {
        if (response.result.ok) finish({ value: response.result.value });
        else {
          finish({
            error: new ExeoraError(response.result.error.code, response.result.error.message),
          });
        }
      } else if (response?.type === "error") {
        finish({ error: new ExeoraError(response.error.code, response.error.message) });
      }
    });
    socket.addEventListener("close", () =>
      finish(newError("The workspace relay closed before it answered.")),
    );
    socket.addEventListener("error", () =>
      finish(newError("The workspace relay connection failed.")),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    send(socket, {
      type: "workspace.start",
      requestId: options.requestId,
      projectId: options.projectId,
      worktreeId: options.worktreeId,
      worktreeSlug: options.worktreeSlug,
      action: options.action,
      issuedAt,
      expiresAt,
    });
  });
}

export async function callRelayTool(
  relay: RelayStub,
  options: {
    requestId: string;
    projectId: string;
    worktreeId?: string | undefined;
    worktreeSlug?: string | undefined;
    tool: ToolName;
    args: unknown;
    client?: { name?: string; version?: string } | undefined;
    policy?: CommandPolicy | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<unknown> {
  if (options.signal?.aborted) throw cancelled();

  const issuedAt = Date.now();
  const expiresAt = issuedAt + RELAY_TIMEOUT_MS;
  const socket = await dial(relay, "tool", options.requestId);
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    close(socket);
    throw new ExeoraError("TOOL_TIMEOUT", "The relay did not open before the deadline.");
  }
  const request: CallerRequest = {
    type: "tool.start",
    requestId: options.requestId,
    projectId: options.projectId,
    worktreeId: options.worktreeId,
    worktreeSlug: options.worktreeSlug,
    tool: options.tool,
    arguments: options.args,
    client: options.client,
    policy: options.policy,
    issuedAt,
    expiresAt,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (answer: { value: unknown } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      close(socket);
      if ("error" in answer) reject(answer.error);
      else resolve(answer.value);
    };
    const cancel = () => {
      if (settled) return;
      observeRelayTermination(options.requestId, Date.now() - issuedAt, "cancelled", {
        caller: 2,
        executor: 2,
      });
      send(socket, { type: "cancel" });
      finish({ error: cancelled() });
    };
    const abort = () => cancel();
    const timeout = () => {
      if (settled) return;
      observeRelayTermination(options.requestId, Date.now() - issuedAt, "timeout", {
        caller: 2,
        executor: 2,
      });
      send(socket, { type: "cancel" });
      finish({
        error: new ExeoraError("TOOL_TIMEOUT", "The device did not answer before the deadline."),
      });
    };
    const timer = setTimeout(timeout, remainingMs);

    socket.addEventListener("message", (event) => {
      if (settled) return;
      // Decoded before the clock is consulted. A frame that arrived is either
      // work the executor really did or the real reason the call failed, and
      // turning either into TOOL_TIMEOUT because it landed a moment past the
      // deadline reports the wrong cause for something that did happen. The
      // deadline is enforced by `timer` and by the executor's own copy of
      // `expiresAt`; this handler only has to not lose an answer that beat it.
      const response = decodeCallerResponse(String(event.data));
      if (response?.type === "tool.result") {
        if (response.result.ok) finish({ value: response.result.value });
        else
          finish({
            error: new ExeoraError(response.result.error.code, response.result.error.message),
          });
      } else if (response?.type === "error") {
        observeRelayTermination(
          options.requestId,
          Date.now() - issuedAt,
          response.error.code === "TOOL_TIMEOUT" ? "timeout" : "offline",
          { caller: 2, executor: 0 },
        );
        finish({ error: new ExeoraError(response.error.code, response.error.message) });
      } else if (Date.now() >= expiresAt) {
        // Nothing to lose in this frame, and the deadline has passed without
        // `timer` having run. Which does happen: an isolate that was busy
        // elsewhere delivers a late timer, and the caller should not wait on it.
        timeout();
      }
    });
    socket.addEventListener("close", () => {
      if (!settled) {
        observeRelayTermination(options.requestId, Date.now() - issuedAt, "offline", {
          caller: 1,
          executor: 1,
        });
      }
      finish({
        error: options.signal?.aborted
          ? cancelled()
          : new ExeoraError(
              "LOCAL_EXECUTOR_OFFLINE",
              "The relay connection closed while the call was in flight.",
            ),
      });
    });
    socket.addEventListener("error", () => {
      if (!settled) {
        observeRelayTermination(options.requestId, Date.now() - issuedAt, "offline", {
          caller: 1,
          executor: 1,
        });
      }
      finish(newError("The relay connection failed while the call was in flight."));
    });
    if (options.signal?.aborted) {
      cancel();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    send(socket, request);
  });
}

export async function requestRelayApproval(
  relay: RelayStub,
  options: {
    id: string;
    projectId: string;
    worktreeId?: string | undefined;
    worktreeSlug?: string | undefined;
    tool: ToolName;
    prompt: string;
    clientName?: string | undefined;
    client?: { name?: string; version?: string } | undefined;
  },
): Promise<ApprovalOutcome> {
  if (options.prompt.length > MAX_APPROVAL_PROMPT_LENGTH) {
    throw new ExeoraError(
      "FORBIDDEN",
      "This call is too large to describe completely, so it cannot be approved safely.",
    );
  }
  const requestedAt = Date.now();
  const expiresAt = requestedAt + APPROVAL_WAIT_MS;
  const socket = await dial(relay, "approval", options.id);
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    close(socket);
    return "unanswered";
  }
  const request: CallerRequest = {
    type: "approval.start",
    ...options,
    ...(options.clientName ? { clientName: options.clientName.slice(0, 256) } : {}),
    requestedAt,
    expiresAt,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (answer: { outcome: ApprovalOutcome } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      close(socket);
      if ("error" in answer) reject(answer.error);
      else resolve(answer.outcome);
    };
    const timeout = () => {
      send(socket, { type: "cancel" });
      finish({ outcome: "unanswered" });
    };
    const timer = setTimeout(timeout, remainingMs);

    socket.addEventListener("message", (event) => {
      if (settled) return;
      // Decoded before the clock is consulted, for the same reason the tool
      // path does it: a frame that arrived carries a decision somebody actually
      // made, and reporting it as `unanswered` because it landed a moment past
      // the deadline throws away the answer and the person's attention with it.
      // The deadline is still enforced by `timer` and by the relay, which
      // refuses to settle a view whose own `expiresAt` has passed.
      const response = decodeCallerResponse(String(event.data));
      if (response?.type === "approval.result") finish({ outcome: response.outcome });
      else if (response?.type === "error") {
        finish({ error: new ExeoraError(response.error.code, response.error.message) });
      } else if (Date.now() >= expiresAt) {
        // Nothing to lose in this frame, and the deadline has passed without
        // `timer` having run. A busy isolate does deliver a late timer.
        timeout();
      }
    });
    socket.addEventListener("close", () => finish({ outcome: "unanswered" }));
    socket.addEventListener("error", () => {
      finish(newError("The relay connection failed while waiting for approval."));
    });
    send(socket, request);
  });
}

async function dial(
  relay: RelayStub,
  kind: "tool" | "workspace" | "approval",
  id: string,
): Promise<WebSocket> {
  const response = await relay.fetch(
    new Request(`https://relay/caller/${kind}?id=${encodeURIComponent(id)}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error(`Relay caller upgrade failed with ${response.status}`);
  socket.accept();
  return socket;
}

function send(socket: WebSocket, message: CallerRequest | { type: "cancel" }): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function close(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(1000, "settled");
}

function cancelled(): ExeoraError {
  return new ExeoraError("CANCELLED", "The call was cancelled before it finished.");
}

function newError(message: string): { error: ExeoraError } {
  return { error: new ExeoraError("LOCAL_EXECUTOR_OFFLINE", message) };
}
