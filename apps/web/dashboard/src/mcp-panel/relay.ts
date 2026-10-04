import type { PanelRelayTicket } from "@exeora/protocol/panel-relay";
import { ticketSocketUrl } from "../socket-url.js";
import type { NavigateArgs, NavigateOptions, NavigateResult, PanelState } from "./controller.js";
import { readPanelId } from "./selection.js";
import { navigateArgs } from "./tools.js";
import { answerText, type CallTool } from "./transport.js";

/**
 * The panel's end of the gateway's Workspace relay: how the model's public
 * `exeora_workspace_get_state` and `exeora_workspace_navigate` tools reach
 * this open panel, whatever the host does with app tools.
 *
 * The panel asks the gateway for a one-use ticket on the connection the
 * person authorized, opens the socket it names, and answers the commands
 * addressed to this panel and this socket's generation, one reply each,
 * through the same controller as everything else that moves it. A command
 * cancelled, past its deadline, or cut off by a lost socket or by Stop is
 * never applied afterwards and gets no reply. A lost socket comes back with a
 * fresh ticket, later each time; Stop keeps it closed until the person
 * resumes. A gateway speaking another protocol, naming another panel, or
 * closing the socket for good (this panel connected again elsewhere, or its
 * registration expired) is not retried: the panel says why.
 *
 * Restated from `@exeora/protocol/panel-relay` so the bundle skips zod.
 */

export const RELAY_PROTOCOL = 1;
export const RELAY_TICKET_TOOL = "exeora_panel_relay_ticket";

export type RelayStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "unavailable"
  /** Disposed for good: the view was torn down, or its session ended. */
  | "closed";

export interface RelayView {
  status: RelayStatus;
  panelId: string | null;
  /** What went wrong, for the person, when the relay is not connected. */
  message: string | null;
  /** Commands from the model being carried out now. */
  busy: number;
}

export interface RelayController {
  state: () => PanelState;
  navigate: (args: NavigateArgs, options: NavigateOptions) => Promise<NavigateResult>;
  /** Called on Stop and disposal: nothing the model asked may still land. */
  stopModel?: () => void;
}

/** The part of a WebSocket the relay uses. */
export interface RelaySocket {
  readonly readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface RelayOptions {
  controller: RelayController;
  /** A fresh one-use ticket for this panel, or one allocated when it has no id yet. */
  ticket: (panelId: string | null) => Promise<PanelRelayTicket>;
  socketUrl?: (url: string) => URL | undefined;
  open?: (url: URL) => RelaySocket;
  pingMs?: number;
  /** How long a socket may stay open without the gateway's greeting. */
  readyMs?: number;
  retryMs?: (attempt: number) => number;
}

const OPEN = 1;
const MAX_PATHS = 1000;
const MAX_PATH = 4096;
const MAX_MESSAGE = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OUT_OF_DATE =
  "This panel and Exeora no longer speak the same version. Reopen the Workspace to let ChatGPT control it.";

/** A failure retrying cannot mend: the panel needs reopening, or another sign-in. */
export class RelayUnavailable extends Error {}

export class PanelRelay {
  private view: RelayView = { status: "stopped", panelId: null, message: null, busy: 0 };
  private listeners = new Set<() => void>();
  private socket: RelaySocket | null = null;
  private generation: string | null = null;
  /** Bumped by every connection attempt, Stop and disposal: older work is moot. */
  private session = 0;
  private attempt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ping: ReturnType<typeof setInterval> | undefined;
  private running = new Map<string, AbortController>();
  private seen: string[] = [];
  private disposed = false;
  private started = false;

  constructor(private readonly options: RelayOptions) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = (): RelayView => this.view;

  /**
   * Connects as `panelId` (or as a panel the gateway names, without one).
   * Called again with the same id, nothing changes; with another, the panel
   * moves to that address, unless the person stopped it.
   */
  start(panelId: string | null): void {
    if (this.disposed) return;
    const id = panelId ?? this.view.panelId;
    if (this.started && id === this.view.panelId) return;
    this.started = true;
    this.update({ panelId: id });
    if (this.view.status === "stopped" && this.session > 0) return;
    this.attempt = 0;
    void this.connect();
  }

  /** The person's Stop: nothing the model asked goes on, and nothing new comes in. */
  stop = (): void => {
    if (this.disposed) return;
    this.shut();
    this.options.controller.stopModel?.();
    this.update({ status: "stopped", message: null });
  };

  /** The person's Resume, or Try again after a failure. */
  resume = (): void => {
    if (this.disposed || !this.started) return;
    this.attempt = 0;
    void this.connect();
  };

  dispose(): void {
    if (this.disposed) return;
    this.shut();
    this.options.controller.stopModel?.();
    this.disposed = true;
    this.update({ status: "closed", message: null });
  }

  private async connect(): Promise<void> {
    this.shut();
    const session = this.session;
    // Retrying, the reason it is retrying stays shown until it connects.
    const retrying = this.attempt > 0;
    this.update({
      status: retrying ? "reconnecting" : "connecting",
      message: retrying ? this.view.message : null,
    });
    let socket: RelaySocket;
    try {
      const ticket = readTicket(await this.options.ticket(this.view.panelId));
      if (session !== this.session) return;
      if (this.view.panelId && ticket.panelId !== this.view.panelId) {
        throw new RelayUnavailable("Exeora answered for another panel. Reopen the Workspace.");
      }
      this.update({ panelId: ticket.panelId });
      const url = (this.options.socketUrl ?? ticketSocketUrl)(ticket.url);
      if (!url) throw new RelayUnavailable("Exeora named a relay address outside the gateway.");
      socket = (this.options.open ?? openSocket)(url);
    } catch (error) {
      if (session !== this.session) return;
      if (error instanceof RelayUnavailable) return this.fail(error.message);
      return this.retry(error instanceof Error ? error.message : "Exeora did not answer.");
    }
    this.socket = socket;
    const greeting = setTimeout(() => {
      if (session === this.session && !this.generation) socket.close(4000, "no greeting");
    }, this.options.readyMs ?? 10_000);
    this.timers.push(greeting);
    socket.onmessage = (event) => {
      if (session === this.session) this.receive(socket, event.data);
    };
    socket.onclose = (event) => {
      if (session !== this.session) return;
      const final = closedFor(event);
      if (final) {
        this.fail(final);
        return;
      }
      this.shut();
      this.retry("The connection to Exeora closed.");
    };
    socket.onerror = () => undefined;
  }

  private receive(socket: RelaySocket, data: unknown): void {
    let message: unknown;
    try {
      message = typeof data === "string" ? JSON.parse(data) : null;
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (message.type === "ready") {
      if (message.protocol !== RELAY_PROTOCOL) {
        this.fail(OUT_OF_DATE);
        return;
      }
      if (message.panelId !== this.view.panelId || !isUuid(message.generation)) {
        this.fail("Exeora greeted another panel. Reopen the Workspace.");
        return;
      }
      this.generation = message.generation;
      socket.send(JSON.stringify({ type: "ready", protocol: RELAY_PROTOCOL }));
      this.attempt = 0;
      clearInterval(this.ping);
      this.ping = setInterval(() => {
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, this.options.pingMs ?? 30_000);
      this.update({ status: "connected", message: null });
      return;
    }
    // Nothing is taken from a socket the gateway has not greeted, or for
    // another generation or panel.
    if (!this.generation || message.protocol !== RELAY_PROTOCOL) return;
    if (message.generation !== this.generation || !isUuid(message.requestId)) return;
    if (message.type === "cancel") {
      this.running.get(message.requestId)?.abort();
      return;
    }
    if (message.type !== "command" || message.panelId !== this.view.panelId) return;
    if (this.seen.includes(message.requestId)) return;
    this.seen = [...this.seen.slice(-199), message.requestId];
    void this.execute(socket, this.generation, message.requestId, message);
  }

  private async execute(
    socket: RelaySocket,
    generation: string,
    requestId: string,
    command: Record<string, unknown>,
  ): Promise<void> {
    const abort = new AbortController();
    const deadline = command.deadline;
    this.running.set(requestId, abort);
    this.update({ busy: this.running.size });
    let result: RelayResult;
    try {
      result = await this.perform(command, abort.signal);
    } finally {
      this.running.delete(requestId);
      this.update({ busy: this.running.size });
    }
    // A command given up on, by either side, is not answered.
    if (abort.signal.aborted || typeof deadline !== "number" || Date.now() > deadline) return;
    if (socket !== this.socket || generation !== this.generation || socket.readyState !== OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({ type: "result", protocol: RELAY_PROTOCOL, requestId, generation, result }),
    );
  }

  private async perform(command: Record<string, unknown>, signal: AbortSignal) {
    const controller = this.options.controller;
    const refuse = (message: string): RelayResult =>
      bounded({ status: "error", message, state: controller.state() });
    const deadline = command.deadline;
    if (typeof deadline !== "number" || !Number.isInteger(deadline) || deadline <= 0) {
      return refuse("The command has no valid deadline.");
    }
    if (command.operation === "get_state") {
      if (!isRecord(command.args) || Object.keys(command.args).length > 0) {
        return refuse("get_state takes no arguments.");
      }
      return bounded({ state: controller.state() });
    }
    if (command.operation !== "navigate") return refuse("Unknown operation.");
    const args = navigateArgs(command.args);
    if (typeof args === "string") return refuse(args);
    const result = await controller.navigate(args, { signal, deadline });
    return bounded(result);
  }

  /** Waits a little longer each time, then connects with a fresh ticket. */
  private retry(message: string): void {
    const delay = (this.options.retryMs ?? backoff)(this.attempt);
    this.attempt += 1;
    const session = this.session;
    this.update({ status: "reconnecting", message });
    this.timers.push(
      setTimeout(() => {
        if (session === this.session) void this.connect();
      }, delay),
    );
  }

  private fail(message: string): void {
    this.shut();
    this.update({ status: "unavailable", message });
  }

  /** Closes the socket and drops what it was doing; later answers are moot. */
  private shut(): void {
    this.session += 1;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    clearInterval(this.ping);
    for (const abort of this.running.values()) abort.abort();
    this.running.clear();
    const socket = this.socket;
    this.socket = null;
    this.generation = null;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, "closed by the panel");
      } catch {
        // Already closing.
      }
    }
    if (this.view.busy) this.update({ busy: 0 });
  }

  private update(patch: Partial<RelayView>): void {
    const next = { ...this.view, ...patch };
    if (
      next.status === this.view.status &&
      next.panelId === this.view.panelId &&
      next.message === this.view.message &&
      next.busy === this.view.busy
    ) {
      return;
    }
    this.view = next;
    for (const listener of this.listeners) listener();
  }
}

/** A navigate or get_state answer, as the gateway's schema allows it. */
export interface RelayResult {
  status?: NavigateResult["status"];
  message?: string;
  state: PanelState;
}

export const TOO_MANY_PATHS =
  "The Workspace has more open or unsaved files than a reply can list, so this state is incomplete. Ask the person to close some tabs or save their edits.";

/**
 * Within the gateway's limits, so a large Workspace never makes a reply
 * unreadable. A state that had to be cut short says so, as an error,
 * whatever the navigation did: it never passes for the whole state.
 */
export function bounded(result: RelayResult): RelayResult {
  let cut = false;
  const paths = (items: string[]) => {
    const kept = items.filter((path) => path.length <= MAX_PATH).slice(0, MAX_PATHS);
    if (kept.length !== items.length) cut = true;
    return kept;
  };
  const state = result.state;
  const path = state.path && state.path.length <= MAX_PATH ? state.path : null;
  if (path !== state.path) cut = true;
  const next: PanelState = {
    ...state,
    path,
    openPaths: paths(state.openPaths),
    dirtyPaths: paths(state.dirtyPaths),
    pendingConfirmation: state.pendingConfirmation
      ? {
          ...state.pendingConfirmation,
          dirtyPaths: paths(state.pendingConfirmation.dirtyPaths),
        }
      : null,
  };
  const message = cut
    ? `${TOO_MANY_PATHS}${result.status ? ` The navigation itself was ${result.status}.` : ""}`
    : result.message;
  return {
    ...(cut ? { status: "error" as const } : result.status ? { status: result.status } : {}),
    ...(message ? { message: message.slice(0, MAX_MESSAGE) } : {}),
    state: next,
  };
}

/** Why the gateway closed the socket for good, or null when it is worth reconnecting. */
function closedFor(event: { code?: number; reason?: string }): string | null {
  if (event.code === 1008) return OUT_OF_DATE;
  if (event.code !== 1000) return null;
  return /replaced/i.test(event.reason ?? "")
    ? "ChatGPT control moved to a newer connection of this panel."
    : "This panel's registration with Exeora expired. Reopen the Workspace to let ChatGPT control it.";
}

/** A ticket as the gateway gives it, or an error saying it is not one. */
export function readTicket(value: unknown): PanelRelayTicket {
  if (!isRecord(value)) throw new Error("Exeora did not give the panel a relay ticket.");
  if (value.protocol !== RELAY_PROTOCOL) throw new RelayUnavailable(OUT_OF_DATE);
  const panelId = readPanelId(value.panelId);
  if (!panelId || typeof value.url !== "string" || typeof value.expiresAt !== "number") {
    throw new Error("Exeora did not give the panel a relay ticket.");
  }
  return {
    panelId,
    protocol: RELAY_PROTOCOL,
    url: value.url,
    expiresAt: value.expiresAt,
    ...(typeof value.pairingTicket === "string" ? { pairingTicket: value.pairingTicket } : {}),
  };
}

/**
 * Tickets for the Workspace panel: asked for over the ChatGPT connection,
 * bound to the sandbox origin the socket comes from.
 */
export function toolTickets(call: CallTool, origin: string) {
  return (panelId: string | null) => askTicket(call, panelId, origin, "workspace");
}

/**
 * Tickets for the Dashboard: the ChatGPT connection names the panel and a
 * pairing ticket, which only the Dashboard's own sign-in can exchange, and
 * only when the gateway finds both are the same account.
 */
export function pairedTickets(
  call: CallTool,
  origin: string,
  exchange: (body: { panelId: string; ticket: string; origin: string }) => Promise<unknown>,
) {
  return async (panelId: string | null): Promise<PanelRelayTicket> => {
    const pairing = await askTicket(call, panelId, origin, "dashboard");
    if (!pairing.pairingTicket) {
      throw new Error("Exeora did not give the Dashboard a pairing ticket.");
    }
    const ticket = readTicket(
      await exchange({ panelId: pairing.panelId, ticket: pairing.pairingTicket, origin }),
    );
    if (ticket.panelId !== pairing.panelId) {
      throw new RelayUnavailable("Exeora paired the Dashboard with another panel.");
    }
    return ticket;
  };
}

async function askTicket(
  call: CallTool,
  panelId: string | null,
  origin: string,
  surface: "workspace" | "dashboard",
): Promise<PanelRelayTicket> {
  const answer = await call(RELAY_TICKET_TOOL, {
    ...(panelId ? { panelId } : {}),
    origin,
    surface,
  });
  if (answer.isError) {
    throw new Error(answerText(answer) || "Exeora did not give the panel a relay ticket.");
  }
  return readTicket(answer.structuredContent);
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

function openSocket(url: URL): RelaySocket {
  return new WebSocket(url) as unknown as RelaySocket;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
