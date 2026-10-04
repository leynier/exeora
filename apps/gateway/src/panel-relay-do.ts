import { DurableObject } from "cloudflare:workers";
import {
  type PanelRelayResult,
  RelayNavigation,
  RelayResponse,
} from "@exeora/protocol/panel-relay";

export interface PanelPrincipal {
  userId: string;
  clientId: string;
  endpoint: string;
}
interface Registration {
  panelId: string;
  principal: PanelPrincipal;
  expiresAt: number;
}
interface Ticket {
  origin: string;
  expiresAt: number;
  kind: "socket" | "pairing";
}
interface Connection {
  panelId: string;
  generation: string;
  ready: boolean;
}
export interface RelayFailure {
  error: string;
  message: string;
}
type Outcome = { result: PanelRelayResult } | RelayFailure;
interface Pending {
  socket: WebSocket;
  generation: string;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: Outcome) => void;
}
const PANEL_LIFETIME = 24 * 60 * 60 * 1000;
const TICKET_LIFETIME = 60_000;
const COMMAND_TIMEOUT = 12_000;
const MAX_MESSAGE = 256 * 1024;
const unavailable = (): RelayFailure => ({
  error: "panel_unavailable",
  message: "This panel is not connected and ready. Open Exeora Workspace and use its panelId.",
});
const forbidden = (): RelayFailure => ({
  error: "panel_unavailable",
  message: "This panel is not available on this connection.",
});

/** One explicit UI instance; it does not depend on a machine being online. */
export class WorkspacePanelRelay extends DurableObject<Env> {
  private pending = new Map<string, Pending>();
  private cancelled = new Map<string, number>();
  private activeGeneration: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.activeGeneration = (await ctx.storage.get<string>("generation")) ?? null;
    });
  }

  async register(principal: PanelPrincipal, panelId: string): Promise<void> {
    // Registration is private RPC. A guessed id can neither create nor replace an owner.
    if (await this.ctx.storage.get("registration")) throw new Error("Panel already registered.");
    const expiresAt = Date.now() + PANEL_LIFETIME;
    await this.ctx.storage.put("registration", { panelId, principal, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt);
  }

  private async registration(): Promise<Registration | undefined> {
    const value = await this.ctx.storage.get<Registration>("registration");
    return value && value.expiresAt > Date.now() ? value : undefined;
  }

  async authorized(principal: PanelPrincipal): Promise<boolean> {
    const stored = (await this.registration())?.principal;
    return (
      !!stored &&
      stored.userId === principal.userId &&
      stored.clientId === principal.clientId &&
      stored.endpoint === principal.endpoint
    );
  }

  async issueTicket(
    principal: PanelPrincipal,
    origin: string,
    kind: Ticket["kind"],
  ): Promise<{ ticket: string; expiresAt: number } | RelayFailure> {
    if (!(await this.authorized(principal))) return forbidden();
    return this.mint(origin, kind);
  }

  private async mint(origin: string, kind: Ticket["kind"]) {
    const ticket = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const expiresAt = Date.now() + TICKET_LIFETIME;
    const issued = await this.ctx.storage.transaction(async (storage) => {
      const tickets = await storage.list<Ticket>({ prefix: "ticket:" });
      let fresh = 0;
      for (const [key, value] of tickets) {
        if (value.expiresAt <= Date.now()) await storage.delete(key);
        else fresh++;
      }
      if (fresh >= 16) return false;
      await storage.put(`ticket:${ticket}`, { origin, expiresAt, kind });
      return true;
    });
    if (!issued)
      return {
        error: "ticket_limit",
        message: "Too many panel connection attempts. Retry in a minute.",
      };
    await this.ctx.storage.setAlarm(expiresAt);
    return { ticket, expiresAt };
  }

  private async consume(ticket: string, origin: string, kind: Ticket["kind"]): Promise<boolean> {
    return this.ctx.storage.transaction(async (storage) => {
      const value = await storage.get<Ticket>(`ticket:${ticket}`);
      await storage.delete(`ticket:${ticket}`);
      return (
        !!value && value.expiresAt > Date.now() && value.origin === origin && value.kind === kind
      );
    });
  }

  /** A Sideapp's separately validated bearer must belong to the MCP owner. */
  async exchangePairing(userId: string, ticket: string, origin: string) {
    const registered = await this.registration();
    if (!registered || registered.principal.userId !== userId) return forbidden();
    if (!(await this.consume(ticket, origin, "pairing")))
      return {
        error: "invalid_ticket",
        message: "The panel pairing ticket is invalid or expired.",
      };
    return this.mint(origin, "socket");
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected WebSocket upgrade.", { status: 426 });
    const url = new URL(request.url);
    const ticket = url.searchParams.get("ticket") ?? "";
    const origin = request.headers.get("Origin") ?? "";
    const registration = await this.registration();
    if (
      !/^[0-9a-f]{64}$/.test(ticket) ||
      !registration ||
      !(await this.consume(ticket, origin, "socket"))
    )
      return new Response("Invalid or expired panel ticket.", { status: 403 });
    for (const previous of this.ctx.getWebSockets()) {
      previous.serializeAttachment({ ...this.connection(previous), ready: false });
      this.failSocket(previous, {
        error: "panel_reconnected",
        message: "The panel reconnected. Check its state before retrying.",
      });
      previous.close(1000, "Replaced by this instance's new connection.");
    }
    const pair = new WebSocketPair();
    const generation = crypto.randomUUID();
    this.activeGeneration = generation;
    await this.ctx.storage.put("generation", generation);
    pair[1].serializeAttachment({
      panelId: registration.panelId,
      generation,
      ready: false,
    } satisfies Connection);
    this.ctx.acceptWebSocket(pair[1]);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
    pair[1].send(
      JSON.stringify({ type: "ready", protocol: 1, panelId: registration.panelId, generation }),
    );
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async command(
    principal: PanelPrincipal,
    operation: "get_state" | "navigate",
    args: unknown,
    requestId: string,
  ): Promise<Outcome> {
    if (!(await this.authorized(principal))) return forbidden();
    for (const [id, expiry] of this.cancelled) if (expiry <= Date.now()) this.cancelled.delete(id);
    if (this.cancelled.has(requestId))
      return { error: "panel_cancelled", message: "The command was cancelled before dispatch." };
    const parsed = RelayNavigation.safeParse(args);
    if (
      !parsed.success ||
      !["get_state", "navigate"].includes(operation) ||
      !/^[0-9a-f-]{36}$/.test(requestId)
    )
      return { error: "invalid_command", message: "Use a supported panel command." };
    const socket = this.ctx.getWebSockets().find((value) => {
      const connection = this.connection(value);
      return connection?.ready && connection.generation === this.activeGeneration;
    });
    const connection = socket && this.connection(socket);
    if (!socket || !connection) return unavailable();
    if (this.pending.size >= 8 || this.pending.has(requestId))
      return { error: "panel_busy", message: "Wait for the panel's current commands to finish." };
    const deadline = Date.now() + COMMAND_TIMEOUT;
    return new Promise<Outcome>((resolve) => {
      const timer = setTimeout(
        () =>
          this.finish(
            requestId,
            {
              error: "panel_timeout",
              message:
                "The panel did not acknowledge before the deadline. Its outcome is unknown; inspect its state before retrying.",
            },
            true,
          ),
        COMMAND_TIMEOUT,
      );
      this.pending.set(requestId, {
        socket,
        generation: connection.generation,
        deadline,
        timer,
        resolve,
      });
      try {
        socket.send(
          JSON.stringify({
            type: "command",
            protocol: 1,
            panelId: connection.panelId,
            requestId,
            generation: connection.generation,
            operation,
            args: parsed.data,
            deadline,
          }),
        );
      } catch {
        this.finish(requestId, unavailable(), true);
      }
    });
  }

  async cancel(principal: PanelPrincipal, requestId: string): Promise<void> {
    if (await this.authorized(principal)) {
      if (this.cancelled.size < 32) this.cancelled.set(requestId, Date.now() + COMMAND_TIMEOUT);
      this.finish(
        requestId,
        {
          error: "panel_cancelled",
          message: "The panel command was cancelled. Check state before retrying.",
        },
        true,
      );
    }
  }

  private connection(socket: WebSocket): Connection | null {
    try {
      return socket.deserializeAttachment() as Connection;
    } catch {
      return null;
    }
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string" || message.length > MAX_MESSAGE) {
      this.webSocketError(socket);
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      this.webSocketError(socket);
      return;
    }
    const connection = this.connection(socket);
    if (!connection || connection.generation !== this.activeGeneration) return;
    if (typeof value === "object" && value !== null && "type" in value && value.type === "ready") {
      if (!("protocol" in value) || value.protocol !== 1) {
        this.webSocketError(socket);
        return;
      }
      socket.serializeAttachment({ ...connection, ready: true });
      return;
    }
    const parsed = RelayResponse.safeParse(value);
    if (!parsed.success) {
      this.webSocketError(socket);
      return;
    }
    const reply = parsed.data;
    const pending = this.pending.get(reply.requestId);
    // A result from another socket/generation cannot settle an outstanding request.
    if (
      !pending ||
      pending.socket !== socket ||
      pending.generation !== reply.generation ||
      connection.generation !== reply.generation
    )
      return;
    if (pending.deadline <= Date.now()) {
      this.finish(
        reply.requestId,
        {
          error: "panel_timeout",
          message: "The command's outcome is unknown. Check the panel state.",
        },
        true,
      );
      return;
    }
    this.finish(reply.requestId, { result: reply.result });
  }

  private finish(requestId: string, value: Outcome, cancel = false): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (cancel)
      try {
        pending.socket.send(
          JSON.stringify({
            type: "cancel",
            protocol: 1,
            requestId,
            generation: pending.generation,
          }),
        );
      } catch {
        /* already disconnected */
      }
    pending.resolve(value);
  }

  private failSocket(socket: WebSocket, failure: RelayFailure): void {
    for (const [id, value] of this.pending)
      if (value.socket === socket) this.finish(id, failure, true);
  }
  override webSocketClose(socket: WebSocket): void {
    socket.serializeAttachment({ ...this.connection(socket), ready: false });
    this.failSocket(socket, unavailable());
  }
  override webSocketError(socket: WebSocket): void {
    socket.serializeAttachment({ ...this.connection(socket), ready: false });
    this.failSocket(socket, {
      error: "panel_protocol",
      message: "The panel relay protocol is invalid. Reopen the panel.",
    });
    socket.close(1008, "Invalid panel relay protocol.");
  }

  override async alarm(): Promise<void> {
    const registered = await this.registration();
    if (!registered) {
      for (const socket of this.ctx.getWebSockets()) {
        this.failSocket(socket, unavailable());
        socket.close(1000, "Panel registration expired.");
      }
      await this.ctx.storage.deleteAll();
      return;
    }
    const tickets = await this.ctx.storage.list<Ticket>({ prefix: "ticket:" });
    let next = registered.expiresAt;
    for (const [key, ticket] of tickets) {
      if (ticket.expiresAt <= Date.now()) await this.ctx.storage.delete(key);
      else next = Math.min(next, ticket.expiresAt);
    }
    await this.ctx.storage.setAlarm(next);
  }
}
