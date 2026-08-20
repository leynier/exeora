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
  PROTOCOL_VERSION,
} from "@exeora/protocol";
import { observeTool } from "./cost-metrics.js";
import "./env.js";
import { touchDevice } from "./presence.js";
import {
  type ApprovalCallerState,
  type ApprovalView,
  attachmentOf,
  callerSocket,
  callerTag,
  type ExecutorSocketState,
  executorSocket,
  failCallers,
  hasOtherExecutor,
  offline,
  relayError,
  resolveTerminalApproval,
  type SocketState,
  sendCancel,
  settleApproval,
  settleCaller,
  type TerminalCallerState,
  type ToolCallerState,
} from "./relay-do-callers.js";
import {
  acceptTerminalSocket,
  closeTerminalSession,
  consumeTerminalTicket,
  expireWorkspaceSessions,
  forwardTerminalMessage,
  handleTerminalCallerMessage,
  issueTerminalTicket,
  scheduleWorkspaceAlarm,
} from "./relay-do-terminal.js";
import { handleWorkspaceCallerMessage } from "./relay-do-workspace.js";
import { decodeCallerRequest } from "./relay-internal.js";

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

    if (
      url.pathname === "/caller/tool" ||
      url.pathname === "/caller/workspace" ||
      url.pathname === "/caller/approval"
    ) {
      const id = url.searchParams.get("id");
      if (!id) return new Response("Missing caller id.", { status: 400 });
      const role =
        url.pathname === "/caller/tool"
          ? "tool"
          : url.pathname === "/caller/workspace"
            ? "workspace"
            : "approval";
      this.ctx.acceptWebSocket(server, ["caller", role, callerTag(role, id)]);
      server.serializeAttachment({ role, id, settled: false } satisfies SocketState);
    } else if (url.pathname === "/caller/terminal") {
      return acceptTerminalSocket(this.ctx, url, client, server);
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
        await touchDevice(this.env, state.deviceId || message.deviceId, {
          cliVersion: message.cliVersion,
          force: true,
          connected: true,
        });
        return;
      }

      case "heartbeat":
        // Legacy dynamic heartbeat. New CLIs use the fixed auto-response frame,
        // which never wakes this object.
        if (message.at !== undefined) await touchDevice(this.env, state.deviceId);
        return;

      case "presence": {
        await touchDevice(this.env, state.deviceId);
        return;
      }

      case "approval.answer": {
        // Unknown ids are normal: the dashboard may have answered first, or the
        // question expired while someone was reading it.
        settleApproval(this.ctx, message.id, message.approved ? "approved" : "declined");
        return;
      }

      case "tool.result": {
        const caller = callerSocket(this.ctx, "tool", message.requestId);
        if (!caller) return;
        const callerState = attachmentOf(caller);
        const issuedAt = callerState?.role === "tool" ? callerState.issuedAt : undefined;
        observeTool(
          message.requestId,
          issuedAt ? Date.now() - issuedAt : message.durationMs,
          this.ctx.getWebSockets("tool").length,
          message.result.ok ? "ok" : "error",
        );
        settleCaller(caller, { type: "tool.result", result: message.result });
        return;
      }

      case "workspace.result": {
        const caller = callerSocket(this.ctx, "workspace", message.requestId);
        if (caller) settleCaller(caller, { type: "workspace.result", result: message.result });
        return;
      }

      case "terminal.opened":
      case "terminal.output":
      case "terminal.exit":
      case "terminal.error": {
        forwardTerminalMessage(this.ctx, message);
        return;
      }
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const state = attachmentOf(socket);
    if (!state) return;
    if (state.role === "executor") {
      const replaced = hasOtherExecutor(this.ctx, socket);
      await touchDevice(this.env, state.deviceId, { force: true, connected: replaced });
      // Only when nothing is left to answer. A close that arrives after the CLI
      // has already redialled belongs to the old socket, and failing every
      // caller for it would kill the calls just dispatched on the new one.
      if (!replaced) failCallers(this.ctx, "The device disconnected while the call was in flight.");
      return;
    }
    if (!state.settled) {
      if (state.role === "tool" || state.role === "workspace") sendCancel(this.ctx, state.id);
      else if (state.role === "terminal") closeTerminalSession(this.ctx, state.id);
      else resolveTerminalApproval(this.ctx, state.id);
    }
    if (state.role === "terminal") await scheduleWorkspaceAlarm(this.ctx);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    const state = attachmentOf(socket);
    if (state?.role === "executor") {
      // A failed socket is gone whether or not a close frame follows, and the
      // runtime does not promise one. Recording it here as well is idempotent.
      const replaced = hasOtherExecutor(this.ctx, socket);
      await touchDevice(this.env, state.deviceId, { force: true, connected: replaced });
      if (!replaced) failCallers(this.ctx, "The connection to the device failed.");
    } else if ((state?.role === "tool" || state?.role === "workspace") && !state.settled)
      sendCancel(this.ctx, state.id);
    else if (state?.role === "terminal" && !state.settled) {
      closeTerminalSession(this.ctx, state.id);
      await scheduleWorkspaceAlarm(this.ctx);
    } else if (state?.role === "approval" && !state.settled)
      resolveTerminalApproval(this.ctx, state.id);
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
    return executorSocket(this.ctx) !== undefined;
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
    const socket = executorSocket(this.ctx);
    if (!socket) return null;
    const state = attachmentOf(socket);
    return state?.role === "executor" ? (state.capabilities ?? BASELINE_CAPABILITIES) : null;
  }

  async createTerminalTicket(
    projectId: string,
    worktreeId: string | undefined,
    worktreeSlug: string | undefined,
    origin: string,
  ): Promise<string | null> {
    return issueTerminalTicket(this.ctx, projectId, worktreeId, worktreeSlug, origin);
  }

  async consumeTerminalTicket(
    token: string,
    projectId: string,
    worktreeId: string | undefined,
    worktreeSlug: string | undefined,
    origin: string,
  ): Promise<boolean> {
    return consumeTerminalTicket(this.ctx, token, projectId, worktreeId, worktreeSlug, origin);
  }

  override async alarm(): Promise<void> {
    await expireWorkspaceSessions(this.ctx);
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
    return settleApproval(this.ctx, id, approved ? "approved" : "declined");
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
    failCallers(this.ctx, "This device was revoked.");
  }

  // ---------------------------------------------------------------------

  private handleCallerMessage(
    socket: WebSocket,
    state: ToolCallerState | ApprovalCallerState | TerminalCallerState,
    raw: string,
  ): void {
    if (state.role === "terminal") {
      handleTerminalCallerMessage(this.ctx, socket, state, raw);
      return;
    }
    const message = decodeCallerRequest(raw);
    if (!message || state.settled) return;

    if (message.type === "cancel") {
      socket.serializeAttachment({ ...state, settled: true } satisfies SocketState);
      if (state.role === "tool" || state.role === "workspace") sendCancel(this.ctx, state.id);
      else resolveTerminalApproval(this.ctx, state.id);
      socket.close(1000, "cancelled");
      return;
    }

    if (state.role === "workspace" && message.type === "workspace.start") {
      handleWorkspaceCallerMessage(this.ctx, socket, state, message);
      return;
    }

    if (state.role === "tool" && message.type === "tool.start") {
      if (message.requestId !== state.id || state.issuedAt !== undefined) return;
      if (message.expiresAt <= Date.now()) {
        settleCaller(socket, relayError("TOOL_TIMEOUT", "The tool call expired before dispatch."));
        return;
      }

      const executor = executorSocket(this.ctx);
      if (!executor) {
        settleCaller(socket, offline("No Exeora CLI is connected for this project."));
        return;
      }
      const executorState = attachmentOf(executor);
      if (
        message.worktreeId &&
        executorState?.role === "executor" &&
        !executorState.capabilities?.worktreeRouting
      ) {
        settleCaller(
          socket,
          relayError(
            "WORKTREE_UNAVAILABLE",
            "The connected Exeora CLI does not support worktree routing. Upgrade it and reconnect.",
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
            worktreeId: message.worktreeId,
            worktreeSlug: message.worktreeSlug,
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
      return;
    }

    if (state.role === "approval" && message.type === "approval.start") {
      if (message.id !== state.id || state.view !== undefined) return;
      if (message.expiresAt <= Date.now()) {
        settleCaller(socket, { type: "approval.result", outcome: "unanswered" });
        return;
      }

      const executor = executorSocket(this.ctx);
      const executorState = executor ? attachmentOf(executor) : null;
      if (!executor || executorState?.role !== "executor") {
        settleCaller(socket, offline("No Exeora CLI is connected for this project."));
        return;
      }

      const view: ApprovalView = {
        id: message.id,
        deviceId: executorState.deviceId,
        projectId: message.projectId,
        ...(message.worktreeId ? { worktreeId: message.worktreeId } : {}),
        ...(message.worktreeSlug ? { worktreeSlug: message.worktreeSlug } : {}),
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
              worktreeId: message.worktreeId,
              worktreeSlug: message.worktreeSlug,
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
}
