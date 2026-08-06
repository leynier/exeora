import { DurableObject } from "cloudflare:workers";
import {
  APPROVAL_WAIT_MS,
  BASELINE_CAPABILITIES,
  type CommandPolicy,
  decodeExecutorMessage,
  type ExecutorCapabilities,
  ExeoraError,
  encodeMessage,
  HEARTBEAT_INTERVAL_MS,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  RELAY_TIMEOUT_MS,
  type ToolName,
  type WireError,
} from "@exeora/protocol";
import "./env.js";

/**
 * One instance per `userId:deviceId`. Holds the single outbound WebSocket the
 * Exeora CLI dials, and turns MCP tool calls into request/response over it.
 *
 * The socket is accepted through the Hibernation API rather than `accept()`:
 * the latter bills duration for the entire time a connection is open, which for
 * a machine that sits connected all day is the whole day. With hibernation an
 * idle device costs nothing.
 *
 * Pending calls live in memory, deliberately. An in-flight RPC keeps the object
 * awake, so nothing is lost while a call is running; and if the object is ever
 * evicted anyway, the caller sees a timeout instead of a command that lands
 * later. A tool call that arrives late is the hazard this whole design refuses
 * to accept, which is also why nothing is queued.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

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

interface PendingApproval {
  settle: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  view: ApprovalView;
}

interface SocketState {
  deviceId: string;
  projectIds: string[];
  /** Absent for an executor that predates the field; read as the baseline. */
  capabilities?: ExecutorCapabilities;
}

export class DeviceRelay extends DurableObject<Env> {
  private readonly pending = new Map<string, Pending>();

  /**
   * Calls waiting on someone to confirm them, keyed by approval id.
   *
   * In memory for the same reason `pending` is: the awaiting RPC keeps the
   * object alive, and an approval that survived an eviction would be one
   * answered long after the client that asked had given up.
   */
  private readonly approvals = new Map<string, PendingApproval>();

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

    const deviceId = new URL(request.url).searchParams.get("deviceId") ?? "";
    const { 0: client, 1: server } = new WebSocketPair();

    // Hibernation-aware accept. Anything we need after a hibernation cycle has
    // to be attached here, because instance fields do not survive it.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ deviceId, projectIds: [] } satisfies SocketState);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;

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

        const state = attachmentOf(socket);
        socket.serializeAttachment({
          deviceId: state?.deviceId ?? message.deviceId,
          projectIds: message.projects.map((project) => project.id),
          ...(message.capabilities ? { capabilities: message.capabilities } : {}),
        } satisfies SocketState);

        socket.send(
          encodeMessage({
            type: "hello.ack",
            serverTime: Date.now(),
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            ...(this.env.LATEST_CLI_VERSION
              ? { latestCliVersion: this.env.LATEST_CLI_VERSION }
              : {}),
          }),
        );
        await this.touch(message.deviceId, message.cliVersion);
        return;
      }

      case "heartbeat": {
        const state = attachmentOf(socket);
        if (state) await this.touch(state.deviceId);
        return;
      }

      case "approval.answer": {
        // Unknown ids are normal: the dashboard may have answered first, or the
        // question expired while someone was reading it.
        this.settleApproval(message.id, message.approved ? "approved" : "declined");
        return;
      }

      case "tool.result": {
        const pending = this.pending.get(message.requestId);
        // No entry means the call already timed out. Dropping the result is
        // correct: the caller has been told it failed.
        if (!pending) return;

        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);

        if (message.result.ok) pending.resolve(message.result.value);
        else pending.reject(toError(message.result.error));
        return;
      }
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const state = attachmentOf(socket);
    if (state) await this.touch(state.deviceId);
    this.failPending("The device disconnected while the call was in flight.");
  }

  override async webSocketError(): Promise<void> {
    this.failPending("The connection to the device failed.");
  }

  // ---------------------------------------------------------------------
  // Caller side
  // ---------------------------------------------------------------------

  async isOnline(): Promise<boolean> {
    return this.ctx.getWebSockets().length > 0;
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
    const socket = this.ctx.getWebSockets()[0];
    if (!socket) return null;

    return attachmentOf(socket)?.capabilities ?? BASELINE_CAPABILITIES;
  }

  /**
   * Runs a tool on the device and waits for its answer.
   *
   * Throws `LOCAL_EXECUTOR_OFFLINE` immediately when nothing is connected. The
   * alternative (parking the request until the machine returns) is how a
   * command ends up running hours after it was asked for.
   */
  async callTool(options: {
    requestId: string;
    projectId: string;
    tool: ToolName;
    args: unknown;
    client?: { name?: string; version?: string } | undefined;
    /** What the account allows here. The executor narrows it, never widens it. */
    policy?: CommandPolicy | undefined;
  }): Promise<unknown> {
    const socket = this.ctx.getWebSockets()[0];
    if (!socket) {
      throw new ExeoraError(
        "LOCAL_EXECUTOR_OFFLINE",
        "No Exeora CLI is connected for this project. Run `exeora connect` on that machine.",
      );
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + RELAY_TIMEOUT_MS;

    const answer = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(options.requestId);
        // Tell the executor too. Without this the relay stops waiting while the
        // command keeps running on someone's machine, which is the same "it
        // landed anyway" hazard the deadline exists to prevent.
        this.sendCancel(options.requestId);
        reject(new ExeoraError("TOOL_TIMEOUT", "The device did not answer before the deadline."));
      }, RELAY_TIMEOUT_MS);

      this.pending.set(options.requestId, { resolve, reject, timer });
    });

    // Marks the promise as observed. Without this, a call that is abandoned by
    // its caller (a disconnected MCP client, a request the runtime already
    // tore down) rejects at the deadline with nobody listening and surfaces as
    // an unhandled rejection inside the object.
    answer.catch(() => undefined);

    socket.send(
      encodeMessage({
        type: "tool.call",
        requestId: options.requestId,
        projectId: options.projectId,
        tool: options.tool,
        arguments: options.args,
        client: options.client,
        policy: options.policy,
        issuedAt,
        expiresAt,
      }),
    );

    return answer;
  }

  /**
   * Asks whether this call may run, and waits for an answer.
   *
   * The path for a client that cannot be asked over MCP, which today is most of
   * them. Two places can answer: the terminal where `exeora connect` is running,
   * if there is one, and the dashboard. **The first answer wins**, and the other
   * side is told the question is over rather than left holding a prompt that no
   * longer does anything.
   *
   * Refuses immediately when nothing is connected, for the same reason
   * `callTool` does: asking someone to confirm a call that cannot run either way
   * wastes the only thing this spends, which is a person's attention.
   */
  async requestApproval(options: {
    id: string;
    projectId: string;
    tool: ToolName;
    prompt: string;
    clientName?: string | undefined;
    client?: { name?: string; version?: string } | undefined;
  }): Promise<ApprovalOutcome> {
    const socket = this.ctx.getWebSockets()[0];
    if (!socket) {
      throw new ExeoraError(
        "LOCAL_EXECUTOR_OFFLINE",
        "No Exeora CLI is connected for this project. Run `exeora connect` on that machine.",
      );
    }

    const state = attachmentOf(socket);
    const requestedAt = Date.now();
    const expiresAt = requestedAt + APPROVAL_WAIT_MS;

    const view: ApprovalView = {
      id: options.id,
      deviceId: state?.deviceId ?? "",
      projectId: options.projectId,
      tool: options.tool,
      prompt: options.prompt,
      ...(options.clientName ? { clientName: options.clientName } : {}),
      requestedAt,
      expiresAt,
    };

    const answer = new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.settleApproval(options.id, "unanswered");
      }, APPROVAL_WAIT_MS);

      this.approvals.set(options.id, { settle: resolve, timer, view });
    });

    // Only to a machine that said it has someone to ask. A CLI running under
    // systemd would drop the frame, and the question would sit here for the
    // full ninety seconds waiting on a terminal nobody is looking at, when the
    // dashboard could have answered it in five.
    if (state?.capabilities?.prompt) {
      try {
        socket.send(
          encodeMessage({
            type: "approval.request",
            id: options.id,
            projectId: options.projectId,
            tool: options.tool,
            prompt: options.prompt,
            client: options.client,
            expiresAt,
          }),
        );
      } catch {
        // The socket went away. The dashboard can still answer, and the tool
        // call that follows will fail on its own if the machine stays gone.
      }
    }

    return answer;
  }

  /** Every question currently waiting, for the dashboard to show and answer. */
  async listApprovals(): Promise<ApprovalView[]> {
    return [...this.approvals.values()].map((approval) => approval.view);
  }

  /**
   * Answers from the dashboard. Returns false when there was nothing to answer,
   * which is what the person sees when the terminal got there first.
   */
  async answerApproval(id: string, approved: boolean): Promise<boolean> {
    return this.settleApproval(id, approved ? "approved" : "declined");
  }

  /**
   * Abandons a call in flight, because the caller went away.
   *
   * Both halves matter. Rejecting the pending entry frees whoever is still
   * awaiting it; sending `cancel` is what actually stops the work, since a
   * `run_command` the MCP client no longer wants would otherwise keep running
   * on the machine for its full timeout with nobody left to read the answer.
   *
   * Safe to call for a request that already finished: the map lookup misses and
   * an executor that does not recognise the id ignores the frame.
   */
  async cancelTool(requestId: string): Promise<void> {
    const pending = this.pending.get(requestId);
    if (pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(new ExeoraError("CANCELLED", "The call was cancelled before it finished."));
    }

    this.sendCancel(requestId);
  }

  /** Closes the socket when the device is revoked from the dashboard. */
  async revoke(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(encodeMessage({ type: "shutdown", reason: "This device was revoked." }));
      } catch {
        // Already gone.
      }
      socket.close(1008, "device revoked");
    }
    this.failPending("This device was revoked.");
  }

  // ---------------------------------------------------------------------

  /**
   * Asks the executor to stop working on one request.
   *
   * Best effort by design: a device that disconnected between the call and the
   * cancellation has already lost the work, so a failure here is not worth
   * surfacing to a caller who is no longer listening either.
   */
  private sendCancel(requestId: string): void {
    const socket = this.ctx.getWebSockets()[0];
    if (!socket) return;

    try {
      socket.send(encodeMessage({ type: "cancel", requestId }));
    } catch {
      // The socket went away; the call is lost regardless.
    }
  }

  /**
   * Ends one question, whoever ended it, and tells the terminal so.
   *
   * The single door every outcome goes through, which is what makes "the first
   * answer wins" true rather than approximately true: the map entry is deleted
   * before anything else happens, so a second answer arriving a millisecond
   * later finds nothing and changes nothing.
   */
  private settleApproval(id: string, outcome: ApprovalOutcome): boolean {
    const approval = this.approvals.get(id);
    if (!approval) return false;

    this.approvals.delete(id);
    clearTimeout(approval.timer);
    approval.settle(outcome);

    const socket = this.ctx.getWebSockets()[0];
    try {
      socket?.send(encodeMessage({ type: "approval.resolved", id }));
    } catch {
      // Best effort: the prompt goes away on its own deadline regardless.
    }

    return true;
  }

  private failPending(reason: string): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ExeoraError("LOCAL_EXECUTOR_OFFLINE", reason));
      this.pending.delete(requestId);
    }

    // A question waiting on a machine that has gone is a question nobody can
    // usefully answer: the call it guards would fail the moment it was let
    // through. Ending them here is what stops the caller waiting the full
    // ninety seconds to be told the machine is offline.
    for (const id of [...this.approvals.keys()]) {
      this.settleApproval(id, "unanswered");
    }
  }

  /** Presence, so the dashboard can show online/offline and a last-seen time. */
  private async touch(deviceId: string, cliVersion?: string): Promise<void> {
    const columns = cliVersion ? "last_seen_at = ?1, cli_version = ?3" : "last_seen_at = ?1";
    const bindings: unknown[] = [Date.now(), deviceId];
    if (cliVersion) bindings.push(cliVersion);

    try {
      await this.env.DB.prepare(`UPDATE devices SET ${columns} WHERE id = ?2`)
        .bind(...bindings)
        .run();
    } catch {
      // Presence is cosmetic; never fail a tool call because of it.
    }
  }
}

function attachmentOf(socket: WebSocket): SocketState | null {
  const attachment = socket.deserializeAttachment();
  return attachment ? (attachment as SocketState) : null;
}

function toError(error: WireError): Error {
  return new ExeoraError(error.code, error.message);
}
