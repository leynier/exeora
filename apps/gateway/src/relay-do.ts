import { DurableObject } from "cloudflare:workers";
import {
  BASELINE_CAPABILITIES,
  type CloudHook,
  decodeExecutorMessage,
  type ExecutorCapabilities,
  encodeMessage,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
} from "@exeora/protocol";
import { recordHookState } from "./cloud/hooks.js";
import { observeTool } from "./cost-metrics.js";
import "./env.js";
import { touchDevice } from "./presence.js";
import {
  handleApprovalCallerMessage,
  handleMcpCallerMessage,
  handleToolCallerMessage,
  handleWorkspaceCallerMessage,
} from "./relay-do-caller-starts.js";
import {
  type ApprovalCallerState,
  type ApprovalView,
  attachmentOf,
  callerSocket,
  callerTag,
  cancelCaller,
  type ExecutorSocketState,
  executorSocket,
  failCallers,
  failUnreadableResult,
  hasOtherExecutor,
  offline,
  resolveTerminalApproval,
  type SocketState,
  settleApproval,
  settleCaller,
  type TerminalCallerState,
  type ToolCallerState,
  waking,
} from "./relay-do-callers.js";
import {
  type CloudRelayConfig,
  createCloudWakeState,
  ensureAwake,
  noteExecutorActivity,
  storeCloudConfig,
} from "./relay-do-cloud.js";
import { type HookRequest, handleHello, requestHookRun } from "./relay-do-hello.js";
import { acceptLogsSocket, closeLogSockets } from "./relay-do-logs.js";
import {
  acceptTerminalSocket,
  closeTerminalTarget,
  consumeTerminalTicket,
  dropExecutor,
  expireWorkspaceSessions,
  forgetAllStoredTerminals,
  forwardTerminalMessage,
  handleTerminalCallerMessage,
  issueTerminalTicket,
  listTerminalSummaries,
  persistDetachedTerminal,
  scheduleWorkspaceAlarm,
} from "./relay-do-terminal.js";
import { decodeCallerRequest } from "./relay-internal.js";
import { clearMcpCatalogs, readMcpCatalogs, replaceMcpCatalog } from "./relay-mcp.js";

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
  /** Whether and how this device has to be woken; see `relay-do-cloud.ts`. */
  private cloud = createCloudWakeState();
  /** A field so a test can hand the object a fetcher: the real one refuses the network there. */
  // Wrapped: the runtime's fetch throws when called as a method of anything.
  private fetcher: typeof fetch = (input, init) => fetch(input, init);

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
    } else if (url.pathname === "/caller/logs") {
      return acceptLogsSocket(this.ctx, url, client, server);
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
    // A tab watching the logs only listens; its heartbeat never wakes this.
    if (!state || state.role === "logs") return;

    if (state.role !== "executor") {
      await this.handleCallerMessage(socket, state, raw);
      return;
    }

    const message = decodeExecutorMessage(raw);
    if (!message) {
      // Malformed: keep the connection, but a result still answers its caller.
      failUnreadableResult(this.ctx, raw);
      return;
    }

    switch (message.type) {
      case "hello":
        return handleHello(this.relay(), socket, state, message);

      case "cloud.hook.state": {
        // A script running is the instance at work, and what it says about
        // the run is kept for the page that shows the instance.
        noteExecutorActivity(this.cloud);
        await recordHookState(this.env, state.deviceId, message.hook, message.run);
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

      case "mcp.catalog": {
        if (!(await replaceMcpCatalog(this.ctx, message.projectId, message.tools))) {
          console.error(`MCP catalog for ${message.projectId} exceeded the byte budget`);
        }
        return;
      }

      case "approval.answer": {
        // Unknown ids are normal: the dashboard may have answered first, or the
        // question expired while someone was reading it.
        settleApproval(this.ctx, message.id, message.approved ? "approved" : "declined");
        return;
      }

      case "tool.result":
      case "mcp.result": {
        noteExecutorActivity(this.cloud);
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
        settleCaller(caller, { type: "tool.result", result: message.result }, this.ctx);
        return;
      }

      case "workspace.result": {
        noteExecutorActivity(this.cloud);
        const caller = callerSocket(this.ctx, "workspace", message.requestId);
        if (caller) settleCaller(caller, { type: "workspace.result", result: message.result });
        return;
      }

      case "terminal.opened":
      case "terminal.output":
      case "terminal.exit":
      case "terminal.error": {
        noteExecutorActivity(this.cloud);
        forwardTerminalMessage(this.ctx, message);
        return;
      }
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const state = attachmentOf(socket);
    if (!state || state.role === "logs") return;
    if (state.role === "executor") {
      // biome-ignore format: keep DeviceRelay under the file-length budget
      await dropExecutor(this.ctx, this.env, state.deviceId, hasOtherExecutor(this.ctx, socket), "The device disconnected while the call was in flight.");
      return;
    }
    if (!state.settled) {
      if (state.role === "tool" || state.role === "workspace") cancelCaller(this.ctx, state);
      else if (state.role === "terminal") await persistDetachedTerminal(this.ctx, socket, state);
      else resolveTerminalApproval(this.ctx, state.id);
    } else if (state.role === "terminal") await scheduleWorkspaceAlarm(this.ctx);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    const state = attachmentOf(socket);
    if (state?.role === "executor") {
      // A failed socket is gone whether or not a close frame follows, and the
      // runtime does not promise one. Recording it here as well is idempotent.
      // biome-ignore format: keep DeviceRelay under the file-length budget
      await dropExecutor(this.ctx, this.env, state.deviceId, hasOtherExecutor(this.ctx, socket), "The connection to the device failed.");
    } else if ((state?.role === "tool" || state?.role === "workspace") && !state.settled)
      cancelCaller(this.ctx, state);
    else if (state?.role === "terminal" && !state.settled)
      await persistDetachedTerminal(this.ctx, socket, state);
    else if (state?.role === "approval" && !state.settled)
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
  async capabilities(options: { wake?: boolean } = {}): Promise<ExecutorCapabilities | null> {
    // A cloud machine that is asleep has nothing connected, and would stay
    // that way for as long as anyone only looked. The dashboard asks with
    // `wake` so opening a workspace is what brings its machine up; the tool
    // catalog asks without, since listing tools is not a reason to bill.
    if (options.wake) {
      const wake = await ensureAwake(this.ctx, this.cloud, this.env, this.fetcher);
      if (!wake.ok) return null;
    }
    const socket = executorSocket(this.ctx);
    if (!socket) return null;
    const state = attachmentOf(socket);
    return state?.role === "executor" ? (state.capabilities ?? BASELINE_CAPABILITIES) : null;
  }

  /** The proxied MCP catalogs of these projects, as JSON keyed by project id. */
  async mcpCatalogs(projectIds: string[]): Promise<string> {
    return JSON.stringify(await readMcpCatalogs(this.ctx, projectIds));
  }

  async createTerminalTicket(
    projectId: string,
    workspaceId: string | undefined,
    workspaceSlug: string | undefined,
    origin: string,
  ): Promise<string | null> {
    // Woken here rather than when the browser connects: the ticket is only
    // worth issuing if the machine can answer within its thirty seconds.
    const wake = await ensureAwake(this.ctx, this.cloud, this.env, this.fetcher);
    if (!wake.ok) return null;
    return issueTerminalTicket(this.ctx, projectId, workspaceId, workspaceSlug, origin);
  }

  /** A ticket to watch the calls on a root or workspace. Never wakes the machine. */
  async createLogsTicket(
    projectId: string,
    workspaceId: string | undefined,
    workspaceSlug: string | undefined,
    origin: string,
  ): Promise<string | null> {
    return issueTerminalTicket(this.ctx, projectId, workspaceId, workspaceSlug, origin, "logs");
  }

  /** What the helpers beside this file are handed: the object's own state. */
  private relay() {
    return { ctx: this.ctx, env: this.env, cloud: this.cloud };
  }

  /** Asks the instance to run one of its project's scripts again, waking it first. */
  async runCloudHook(hook: CloudHook): Promise<HookRequest | "waking"> {
    const wake = await ensureAwake(this.ctx, this.cloud, this.env, this.fetcher);
    if (!wake.ok) return "waking";
    return requestHookRun(this.relay(), hook);
  }

  /**
   * Tells this relay that its device is a cloud machine at `config.url`, or,
   * with null, that it no longer is. Written by provisioning, once.
   */
  async configureCloud(config: CloudRelayConfig | null): Promise<void> {
    await storeCloudConfig(this.ctx, this.cloud, config);
  }

  async consumeTerminalTicket(
    token: string,
    projectId: string,
    workspaceId: string | undefined,
    workspaceSlug: string | undefined,
    origin: string,
    kind: "terminal" | "logs" = "terminal",
  ): Promise<boolean> {
    // biome-ignore format: keep DeviceRelay under the file-length budget
    return consumeTerminalTicket(this.ctx, token, projectId, workspaceId, workspaceSlug, origin, kind);
  }

  async listTerminals() {
    return listTerminalSummaries(this.ctx);
  }

  async closeTerminal(projectId: string, workspaceId: string | undefined): Promise<boolean> {
    return closeTerminalTarget(this.ctx, projectId, workspaceId);
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
    closeLogSockets(this.ctx, "device revoked");
    await forgetAllStoredTerminals(this.ctx);
    await clearMcpCatalogs(this.ctx);
    await storeCloudConfig(this.ctx, this.cloud, null);
  }

  // ---------------------------------------------------------------------

  private async handleCallerMessage(
    socket: WebSocket,
    state: ToolCallerState | ApprovalCallerState | TerminalCallerState,
    raw: string,
  ): Promise<void> {
    if (state.role === "terminal") {
      handleTerminalCallerMessage(this.ctx, socket, state, raw);
      return;
    }
    const message = decodeCallerRequest(raw);
    if (!message || state.settled) return;

    if (message.type === "cancel") {
      socket.serializeAttachment({ ...state, settled: true } satisfies SocketState);
      if (state.role === "tool" || state.role === "workspace") cancelCaller(this.ctx, state);
      else resolveTerminalApproval(this.ctx, state.id);
      socket.close(1000, "cancelled");
      return;
    }

    // Everything left needs the executor, an approval included, and a machine
    // that sleeps has to be up before its socket is worth writing to. The wait
    // is skipped for a local device and for a machine known to be awake, so it
    // costs nothing on the path every call takes today.
    const wake = await ensureAwake(this.ctx, this.cloud, this.env, this.fetcher);
    if (!wake.ok) {
      settleCaller(socket, wake.waking ? waking(wake.message) : offline(wake.message));
      return;
    }
    // Re-read after the wait: the caller may have cancelled meanwhile, and the
    // handlers below write the attachment back from what they are given.
    const fresh = attachmentOf(socket);
    if (!fresh || fresh.role === "executor" || fresh.settled) return;

    if (fresh.role === "approval" && message.type === "approval.start") {
      handleApprovalCallerMessage(this.ctx, socket, fresh, message);
    } else if (fresh.role === "workspace" && message.type === "workspace.start") {
      handleWorkspaceCallerMessage(this.ctx, socket, fresh, message);
    } else if (fresh.role === "tool" && message.type === "tool.start") {
      handleToolCallerMessage(this.ctx, socket, fresh, message);
    } else if (fresh.role === "tool" && message.type === "mcp.start") {
      handleMcpCallerMessage(this.ctx, socket, fresh, message);
    }
  }
}
