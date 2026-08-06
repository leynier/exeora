import { DurableObject } from "cloudflare:workers";
import {
  decodeExecutorMessage,
  ExeoraError,
  encodeMessage,
  HEARTBEAT_INTERVAL_MS,
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

interface SocketState {
  deviceId: string;
  projectIds: string[];
}

export class DeviceRelay extends DurableObject<Env> {
  private readonly pending = new Map<string, Pending>();

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
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          socket.send(
            encodeMessage({
              type: "shutdown",
              reason: `This gateway speaks protocol v${PROTOCOL_VERSION}; the CLI speaks v${message.protocolVersion}. Update the CLI.`,
            }),
          );
          socket.close(1008, "protocol version mismatch");
          return;
        }

        const state = attachmentOf(socket);
        socket.serializeAttachment({
          deviceId: state?.deviceId ?? message.deviceId,
          projectIds: message.projects.map((project) => project.id),
        } satisfies SocketState);

        socket.send(
          encodeMessage({
            type: "hello.ack",
            serverTime: Date.now(),
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
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
        issuedAt,
        expiresAt,
      }),
    );

    return answer;
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

  private failPending(reason: string): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ExeoraError("LOCAL_EXECUTOR_OFFLINE", reason));
      this.pending.delete(requestId);
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
