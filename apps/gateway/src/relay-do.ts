import { DurableObject } from "cloudflare:workers";
import {
  BASELINE_CAPABILITIES,
  decodeExecutorMessage,
  type ExecutorCapabilities,
  encodeMessage,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  type McpToolsMessage,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from "@exeora/protocol";
import { observeTool } from "./cost-metrics.js";
// biome-ignore format: the wrapped form of this import spends four lines to say one thing
import { forgetStoredMcpTools, forwardMcpStart, readMcpTools, storeMcpTools } from "./relay-do-mcp.js";
import "./env.js";
import { touchDevice } from "./presence.js";
import { handleToolCallerMessage, handleWorkspaceCallerMessage } from "./relay-do-caller-starts.js";
import {
  type ApprovalCallerState,
  type ApprovalView,
  attachmentOf,
  callerSocket,
  callerTag,
  type ExecutorSocketState,
  executorSocket,
  failCallers,
  offline,
  replaceOtherExecutors,
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
  consumeTerminalTicket,
  expireWorkspaceSessions,
  forgetAllStoredTerminals,
  forwardTerminalMessage,
  handleSocketClose,
  handleSocketError,
  handleTerminalCallerMessage,
  issueTerminalTicket,
  listTerminalSummaries,
} from "./relay-do-terminal.js";
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

        replaceOtherExecutors(this.ctx, socket);
        socket.serializeAttachment({
          role: "executor",
          deviceId: state.deviceId || message.deviceId,
          active: true,
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

      case "mcp.tools": {
        await storeMcpTools(this.ctx, message, raw);
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
    await handleSocketClose(this.ctx, this.env, socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await handleSocketError(this.ctx, this.env, socket);
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

  /** One project's downstream MCP servers, or null when nothing was announced. */
  async mcpTools(projectId: string): Promise<McpToolsMessage["servers"] | null> {
    return readMcpTools(this.ctx, projectId);
  }

  async createTerminalTicket(
    projectId: string,
    workspaceId: string | undefined,
    workspaceSlug: string | undefined,
    origin: string,
  ): Promise<string | null> {
    return issueTerminalTicket(this.ctx, projectId, workspaceId, workspaceSlug, origin);
  }

  async consumeTerminalTicket(
    token: string,
    projectId: string,
    workspaceId: string | undefined,
    workspaceSlug: string | undefined,
    origin: string,
  ): Promise<boolean> {
    return consumeTerminalTicket(this.ctx, token, projectId, workspaceId, workspaceSlug, origin);
  }

  async listTerminals() {
    return listTerminalSummaries(this.ctx);
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
    await forgetAllStoredTerminals(this.ctx);
    // A revoked machine's announcements are stale the moment the socket dies:
    // nobody may reconfigure the projects of a device they no longer control.
    await forgetStoredMcpTools(this.ctx);
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

    if (state.role === "tool" && message.type === "mcp.start") {
      forwardMcpStart(this.ctx, socket, state, message);
      return;
    }

    if (state.role === "tool" && message.type === "tool.start") {
      handleToolCallerMessage(this.ctx, socket, state, message);
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
  }
}
