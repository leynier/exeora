import { DurableObject } from "cloudflare:workers";
import {
  BASELINE_CAPABILITIES,
  decodeExecutorMessage,
  type ExecutorCapabilities,
  encodeMessage,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PRESENCE_CHECKPOINT_INTERVAL_MS,
  PRESENCE_SIGNAL_INTERVAL_MS,
  PROTOCOL_VERSION,
  type ToolName,
} from "@exeora/protocol";
import { observeD1, observeTool } from "./cost-metrics.js";
import "./env.js";
import { type CallerResponse, decodeCallerRequest } from "./relay-internal.js";

/**
 * One instance per `userId:deviceId`. Holds the single outbound WebSocket the
 * Exeora CLI dials, and turns MCP tool calls into request/response over it.
 *
 * The socket is accepted through the Hibernation API rather than `accept()`:
 * the latter bills duration for the entire time a connection is open, which for
 * a machine that sits connected all day is the whole day. With hibernation an
 * idle device costs nothing.
 *
 * Tool callers and approval waiters also attach with hibernation-aware
 * WebSockets. Their request id and visible approval state live in serialized
 * socket attachments, so a long local command no longer pins this object in
 * memory. Deadlines stay in the caller Worker and on the executor frame; calls
 * are never queued for a disconnected machine.
 */

/** How a request to confirm a call ended. */
export type ApprovalOutcome = "approved" | "declined" | "unanswered";

/** A pending approval as the dashboard needs to show it. */
export interface ApprovalView {
  id: string;
  deviceId: string;
  projectId: string;
  tool: ToolName;
  prompt: string;
  clientName?: string;
  requestedAt: number;
  expiresAt: number;
}

interface ExecutorSocketState {
  role: "executor";
  deviceId: string;
  /** Absent for an executor that predates the field; read as the baseline. */
  capabilities?: ExecutorCapabilities;
}

interface ToolCallerState {
  role: "tool";
  id: string;
  settled: boolean;
  issuedAt?: number;
}

interface ApprovalCallerState {
  role: "approval";
  id: string;
  settled: boolean;
  view?: ApprovalView;
}

type SocketState = ExecutorSocketState | ToolCallerState | ApprovalCallerState;

export class DeviceRelay extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE),
    );
  }

  // ---------------------------------------------------------------------
  // Executor side
  // ---------------------------------------------------------------------

  /**
   * Accepts the CLI's socket. The Worker has already checked the bearer token
   * and that the device belongs to the caller and is not revoked.
   *
   * This has to be `fetch` rather than an RPC method: a Response carrying a
   * WebSocket cannot be serialised across an RPC boundary, and returning one
   * fails with DataCloneError.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const url = new URL(request.url);
    const { 0: client, 1: server } = new WebSocketPair();

    if (url.pathname === "/caller/tool" || url.pathname === "/caller/approval") {
      const id = url.searchParams.get("id");
      if (!id) return new Response("Missing caller id.", { status: 400 });
      const role = url.pathname === "/caller/tool" ? "tool" : "approval";
      this.ctx.acceptWebSocket(server, ["caller", role, callerTag(role, id)]);
      server.serializeAttachment({ role, id, settled: false } satisfies SocketState);
    } else {
      const deviceId = url.searchParams.get("deviceId") ?? "";
      this.ctx.acceptWebSocket(server, ["executor"]);
      server.serializeAttachment({
        role: "executor",
        deviceId,
      } satisfies ExecutorSocketState);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    const state = attachmentOf(socket);
    if (!state) return;

    if (state.role !== "executor") {
      this.handleCallerMessage(socket, state, raw);
      return;
    }

    const message = decodeExecutorMessage(raw);
    if (!message) return; // malformed frame: drop it, keep the connection

    switch (message.type) {
      case "hello": {
        // A range, not an equality. Anything a newer CLI gained is negotiated
        // through `capabilities`, so an older one is behind rather than broken,
        // and only a change it would get actively wrong raises the floor.
        const supported =
          message.protocolVersion >= MIN_SUPPORTED_PROTOCOL_VERSION &&
          message.protocolVersion <= PROTOCOL_VERSION;

        if (!supported) {
          const direction =
            message.protocolVersion > PROTOCOL_VERSION
              ? "This CLI is newer than the gateway. It will work again once the gateway catches up."
              : "Update the CLI.";

          socket.send(
            encodeMessage({
              type: "shutdown",
              reason:
                `This gateway speaks protocol v${MIN_SUPPORTED_PROTOCOL_VERSION} to v${PROTOCOL_VERSION}; ` +
                `the CLI speaks v${message.protocolVersion}. ${direction}`,
            }),
          );
          socket.close(1008, "protocol version mismatch");
          return;
        }

        socket.serializeAttachment({
          role: "executor",
          deviceId: state.deviceId || message.deviceId,
          ...(message.capabilities ? { capabilities: message.capabilities } : {}),
        } satisfies ExecutorSocketState);

        socket.send(
          encodeMessage({
            type: "hello.ack",
            serverTime: Date.now(),
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            heartbeatMode: "auto",
            ...(this.env.LATEST_CLI_VERSION
              ? { latestCliVersion: this.env.LATEST_CLI_VERSION }
              : {}),
          }),
        );
        // The id from the upgrade URL, which the Worker checked belongs to the
        // caller, in preference to the one in the frame. `devices` is keyed by
        // id alone, so trusting the frame would let any account refresh the
        // presence and CLI version of a machine it does not own.
        await this.touch(state.deviceId || message.deviceId, {
          cliVersion: message.cliVersion,
          force: true,
          connected: true,
        });
        return;
      }

      case "heartbeat":
        // Legacy dynamic heartbeat. New CLIs use the fixed auto-response frame,
        // which never wakes this object.
        if (message.at !== undefined) await this.touch(state.deviceId);
        return;

      case "presence": {
        await this.touch(state.deviceId);
        return;
      }

      case "approval.answer": {
        // Unknown ids are normal: the dashboard may have answered first, or the
        // question expired while someone was reading it.
        this.settleApproval(message.id, message.approved ? "approved" : "declined");
        return;
      }

      case "tool.result": {
        const caller = this.callerSocket("tool", message.requestId);
        if (!caller) return;
        const callerState = attachmentOf(caller);
        const issuedAt = callerState?.role === "tool" ? callerState.issuedAt : undefined;
        observeTool(
          message.requestId,
          issuedAt ? Date.now() - issuedAt : message.durationMs,
          this.ctx.getWebSockets("tool").length,
          message.result.ok ? "ok" : "error",
        );
        this.settleCaller(caller, { type: "tool.result", result: message.result });
        return;
      }
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const state = attachmentOf(socket);
    if (!state) return;
    if (state.role === "executor") {
      const replaced = this.hasOtherExecutor(socket);
      await this.touch(state.deviceId, { force: true, connected: replaced });
      // Only when nothing is left to answer. A close that arrives after the CLI
      // has already redialled belongs to the old socket, and failing every
      // caller for it would kill the calls just dispatched on the new one.
      if (!replaced) this.failCallers("The device disconnected while the call was in flight.");
      return;
    }
    if (!state.settled) {
      if (state.role === "tool") this.sendCancel(state.id);
      else this.resolveTerminalApproval(state.id);
    }
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    const state = attachmentOf(socket);
    if (state?.role === "executor") {
      // A failed socket is gone whether or not a close frame follows, and the
      // runtime does not promise one. Recording it here as well is idempotent.
      const replaced = this.hasOtherExecutor(socket);
      await this.touch(state.deviceId, { force: true, connected: replaced });
      if (!replaced) this.failCallers("The connection to the device failed.");
    } else if (state?.role === "tool" && !state.settled) this.sendCancel(state.id);
    else if (state?.role === "approval" && !state.settled) this.resolveTerminalApproval(state.id);
  }

  // ---------------------------------------------------------------------
  // Caller side
  // ---------------------------------------------------------------------

  /**
   * The relay's own view of whether a socket is attached.
   *
   * No route calls this: presence for a list of machines is read from D1, which
   * costs one query instead of one Durable Object round trip per row. It stays
   * because it is the ground truth the D1 columns are a record of, and it is
   * what the tests here assert against; a caller that needs a single machine's
   * exact state, rather than a list's, should use it.
   */
  async isOnline(): Promise<boolean> {
    return this.executorSocket() !== undefined;
  }

  /**
   * What the connected executor can do, or null when nothing is connected.
   *
   * Null and "the baseline" are different answers and callers need both: an
   * offline machine has no capabilities to report, which is not the same as a
   * machine reporting the six tools every version has. Advertising nothing
   * because a laptop is asleep would be the wrong answer to a different
   * question.
   */
  async capabilities(): Promise<ExecutorCapabilities | null> {
    const socket = this.executorSocket();
    if (!socket) return null;
    const state = attachmentOf(socket);
    return state?.role === "executor" ? (state.capabilities ?? BASELINE_CAPABILITIES) : null;
  }

  /** Every question currently waiting, for the dashboard to show and answer. */
  async listApprovals(): Promise<ApprovalView[]> {
    return this.ctx
      .getWebSockets("approval")
      .map(attachmentOf)
      .filter(
        (state): state is ApprovalCallerState =>
          state?.role === "approval" && !state.settled && state.view !== undefined,
      )
      .map((state) => state.view as ApprovalView);
  }

  /**
   * Answers from the dashboard. Returns false when there was nothing to answer,
   * which is what the person sees when the terminal got there first.
   */
  async answerApproval(id: string, approved: boolean): Promise<boolean> {
    return this.settleApproval(id, approved ? "approved" : "declined");
  }

  /** Closes the socket when the device is revoked from the dashboard. */
  async revoke(): Promise<void> {
    for (const socket of this.ctx.getWebSockets("executor")) {
      try {
        socket.send(encodeMessage({ type: "shutdown", reason: "This device was revoked." }));
      } catch {
        // Already gone.
      }
      socket.close(1008, "device revoked");
    }
    this.failCallers("This device was revoked.");
  }

  // ---------------------------------------------------------------------

  private handleCallerMessage(
    socket: WebSocket,
    state: ToolCallerState | ApprovalCallerState,
    raw: string,
  ): void {
    const message = decodeCallerRequest(raw);
    if (!message || state.settled) return;

    if (message.type === "cancel") {
      socket.serializeAttachment({ ...state, settled: true } satisfies SocketState);
      if (state.role === "tool") this.sendCancel(state.id);
      else this.resolveTerminalApproval(state.id);
      socket.close(1000, "cancelled");
      return;
    }

    if (state.role === "tool" && message.type === "tool.start") {
      if (message.requestId !== state.id || state.issuedAt !== undefined) return;
      if (message.expiresAt <= Date.now()) {
        this.settleCaller(
          socket,
          relayError("TOOL_TIMEOUT", "The tool call expired before dispatch."),
        );
        return;
      }

      const executor = this.executorSocket();
      if (!executor) {
        this.settleCaller(socket, offline("No Exeora CLI is connected for this project."));
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
            tool: message.tool,
            arguments: message.arguments,
            client: message.client,
            policy: message.policy,
            issuedAt: message.issuedAt,
            expiresAt: message.expiresAt,
          }),
        );
      } catch {
        this.settleCaller(socket, offline("The connection to the device failed."));
      }
      return;
    }

    if (state.role === "approval" && message.type === "approval.start") {
      if (message.id !== state.id || state.view !== undefined) return;
      if (message.expiresAt <= Date.now()) {
        this.settleCaller(socket, { type: "approval.result", outcome: "unanswered" });
        return;
      }

      const executor = this.executorSocket();
      const executorState = executor ? attachmentOf(executor) : null;
      if (!executor || executorState?.role !== "executor") {
        this.settleCaller(socket, offline("No Exeora CLI is connected for this project."));
        return;
      }

      const view: ApprovalView = {
        id: message.id,
        deviceId: executorState.deviceId,
        projectId: message.projectId,
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
  }

  /**
   * Asks the executor to stop working on one request.
   *
   * Best effort by design: a device that disconnected between the call and the
   * cancellation has already lost the work, so a failure here is not worth
   * surfacing to a caller who is no longer listening either.
   */
  private sendCancel(requestId: string): void {
    const socket = this.executorSocket();
    if (!socket) return;

    try {
      socket.send(encodeMessage({ type: "cancel", requestId }));
    } catch {
      // The socket went away; the call is lost regardless.
    }
  }

  private settleApproval(id: string, outcome: ApprovalOutcome): boolean {
    const caller = this.callerSocket("approval", id);
    if (!caller) return false;
    const state = attachmentOf(caller);
    if (state?.role !== "approval" || !state.view) return false;
    if (state.view.expiresAt <= Date.now()) {
      this.settleCaller(caller, { type: "approval.result", outcome: "unanswered" });
      this.resolveTerminalApproval(id);
      return false;
    }
    this.settleCaller(caller, { type: "approval.result", outcome });
    this.resolveTerminalApproval(id);
    return true;
  }

  private resolveTerminalApproval(id: string): void {
    const executor = this.executorSocket();
    try {
      executor?.send(encodeMessage({ type: "approval.resolved", id }));
    } catch {
      // Best effort: the prompt goes away on its own deadline regardless.
    }
  }

  private callerSocket(role: "tool" | "approval", id: string): WebSocket | undefined {
    return this.ctx.getWebSockets(callerTag(role, id)).find((socket) => {
      const state = attachmentOf(socket);
      return state?.role !== "executor" && state?.settled === false;
    });
  }

  private settleCaller(socket: WebSocket, response: CallerResponse): void {
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

  private failCallers(reason: string): void {
    for (const socket of this.ctx.getWebSockets("tool")) {
      this.settleCaller(socket, offline(reason));
    }
    for (const socket of this.ctx.getWebSockets("approval")) {
      const state = attachmentOf(socket);
      if (state?.role === "approval") {
        this.settleCaller(socket, { type: "approval.result", outcome: "unanswered" });
        this.resolveTerminalApproval(state.id);
      }
    }
  }

  private executorSocket(): WebSocket | undefined {
    return this.ctx.getWebSockets("executor")[0];
  }

  /**
   * Whether a socket other than this one is still attached as the executor.
   *
   * A close arriving for a socket the CLI has already replaced must not record
   * a disconnection: a machine that dropped and redialled faster than the old
   * connection was noticed would be marked offline while it is sitting there
   * connected. The closing socket may or may not still be in the list, so the
   * question is asked about the others rather than about the count.
   */
  private hasOtherExecutor(closing: WebSocket): boolean {
    return this.ctx.getWebSockets("executor").some((socket) => socket !== closing);
  }

  /**
   * Presence, so the dashboard can show online/offline and a last-seen time.
   *
   * `connected` is what separates a machine that left from one that is merely
   * between checkpoints, and it is only passed by the events that know: the
   * hello frame and the two ways a socket ends. Heartbeats leave the column
   * alone, since they say nothing a stale `disconnected_at` would contradict.
   */
  private async touch(
    deviceId: string,
    options: { cliVersion?: string | undefined; force?: boolean; connected?: boolean } = {},
  ): Promise<void> {
    const { cliVersion, force = false, connected } = options;
    const assignments = ["last_seen_at = ?1"];
    const bindings: unknown[] = [Date.now(), deviceId];
    if (cliVersion) {
      assignments.push(`cli_version = ?${bindings.push(cliVersion)}`);
    }
    if (connected !== undefined) {
      assignments.push(connected ? "disconnected_at = NULL" : "disconnected_at = ?1");
    }
    // The debounce fires one signal early on purpose. It is only ever evaluated
    // when a presence frame arrives, and those arrive every
    // `PRESENCE_SIGNAL_INTERVAL_MS`; comparing against the full checkpoint
    // interval would mean the first eligible frame is the one after it, pushing
    // the real write cadence out to checkpoint + signal. `PRESENCE_TIMEOUT_MS`
    // is sized against the checkpoint interval alone, so that extra signal
    // would come straight out of the slack the window has for a missed write.
    const staleness = PRESENCE_CHECKPOINT_INTERVAL_MS - PRESENCE_SIGNAL_INTERVAL_MS;
    const checkpoint = force
      ? ""
      : ` AND (last_seen_at IS NULL OR last_seen_at < ${Date.now() - staleness})`;

    try {
      const result = await this.env.DB.prepare(
        `UPDATE devices SET ${assignments.join(", ")} WHERE id = ?2${checkpoint}`,
      )
        .bind(...bindings)
        .run();
      observeD1(
        `${deviceId}:${Math.floor(Date.now() / HEARTBEAT_INTERVAL_MS)}`,
        "presence.touch",
        result.meta,
      );
    } catch {
      // Presence is cosmetic; never fail a tool call because of it.
    }
  }
}

function attachmentOf(socket: WebSocket): SocketState | null {
  const attachment = socket.deserializeAttachment();
  return attachment ? (attachment as SocketState) : null;
}

function callerTag(role: "tool" | "approval", id: string): string {
  return `${role}:${id}`;
}

function relayError(code: "TOOL_TIMEOUT", message: string): CallerResponse {
  return { type: "error", error: { code, message } };
}

function offline(message: string): CallerResponse {
  return { type: "error", error: { code: "LOCAL_EXECUTOR_OFFLINE", message } };
}
