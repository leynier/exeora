import { RelayResponse } from "@exeora/protocol/panel-relay";
import { describe, expect, it, vi } from "vitest";
import type { NavigateArgs, NavigateOptions, NavigateResult, PanelState } from "./controller.js";
import { PanelRelay, type RelaySocket } from "./relay.js";

const PANEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GEN = "33333333-3333-4333-8333-333333333333";
const GEN2 = "44444444-4444-4444-8444-444444444444";
const REQ = "55555555-5555-4555-8555-555555555555";
const REQ2 = "66666666-6666-4666-8666-666666666666";

const STATE: PanelState = {
  projectId: "p1",
  workspace: null,
  tab: "explorer",
  path: "src/a.ts",
  diff: null,
  openPaths: ["src/a.ts"],
  dirtyPaths: [],
  search: null,
  pendingConfirmation: null,
  lastConfirmation: null,
};

class FakeSocket implements RelaySocket {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: RelaySocket["onopen"] = null;
  onmessage: RelaySocket["onmessage"] = null;
  onclose: RelaySocket["onclose"] = null;
  onerror: RelaySocket["onerror"] = null;
  constructor(readonly url: URL) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  /** The gateway says something. */
  say(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** The gateway's end goes away. */
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
  results() {
    return this.sent.filter((message) => message.type === "result");
  }
}

type Navigate = (args: NavigateArgs, options: NavigateOptions) => Promise<NavigateResult>;

function setup(navigate?: Navigate) {
  const sockets: FakeSocket[] = [];
  const controller = {
    state: vi.fn(() => STATE),
    navigate: vi.fn<Navigate>(
      navigate ?? (async () => ({ status: "applied" as const, state: STATE })),
    ),
    stopModel: vi.fn(),
  };
  const ticket = vi.fn(async (panelId: string | null) => ({
    panelId: panelId ?? PANEL,
    protocol: 1 as const,
    url: `https://gw.test/relay?ticket=t${ticket.mock.calls.length}`,
    expiresAt: Date.now() + 60_000,
  }));
  const relay = new PanelRelay({
    controller,
    ticket,
    socketUrl: (url) => new URL(url.replace("https:", "wss:")),
    open: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    retryMs: () => 1,
  });
  const socket = async (index = 0) => {
    await vi.waitFor(() => expect(sockets[index]).toBeDefined());
    return sockets[index] as FakeSocket;
  };
  /** Connects, and has the gateway greet the panel. */
  const ready = async (generation = GEN, index?: number) => {
    const s = await socket(index);
    s.say({ type: "ready", protocol: 1, panelId: relay.get().panelId, generation });
    return s;
  };
  return { relay, controller, ticket, sockets, socket, ready };
}

const command = (extra: Record<string, unknown> = {}) => ({
  type: "command",
  protocol: 1,
  panelId: PANEL,
  requestId: REQ,
  generation: GEN,
  operation: "get_state",
  args: {},
  deadline: Date.now() + 10_000,
  ...extra,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("PanelRelay", () => {
  it("connects as its panel, answers the greeting, and says it is connected", async () => {
    const { relay, ticket, ready } = setup();
    relay.start(PANEL);
    expect(relay.get().status).toBe("connecting");
    const s = await ready();
    expect(ticket).toHaveBeenCalledWith(PANEL);
    expect(s.url.toString()).toBe("wss://gw.test/relay?ticket=t1");
    expect(s.sent).toEqual([{ type: "ready", protocol: 1 }]);
    expect(relay.get()).toMatchObject({ status: "connected", panelId: PANEL });
  });

  it("takes the id the gateway allocates when the opening named none", async () => {
    const { relay, ticket, ready } = setup();
    relay.start(null);
    await ready();
    expect(ticket).toHaveBeenCalledWith(null);
    expect(relay.get().panelId).toBe(PANEL);
  });

  it("answers get_state with the controller's state, in the gateway's own schema", async () => {
    const { relay, ready } = setup();
    relay.start(PANEL);
    const s = await ready();
    s.say(command());
    await vi.waitFor(() => expect(s.results()).toHaveLength(1));
    const reply = s.results()[0];
    expect(reply).toEqual({
      type: "result",
      protocol: 1,
      requestId: REQ,
      generation: GEN,
      result: { state: STATE },
    });
    expect(RelayResponse.parse(reply)).toBeTruthy();
  });

  it("navigates through the controller, with the command's deadline and a signal", async () => {
    const { relay, controller, ready } = setup();
    relay.start(PANEL);
    const s = await ready();
    const deadline = Date.now() + 10_000;
    s.say(command({ operation: "navigate", args: { tab: "logs" }, deadline }));
    await vi.waitFor(() => expect(s.results()).toHaveLength(1));
    expect(controller.navigate).toHaveBeenCalledWith(
      { tab: "logs" },
      { signal: expect.any(AbortSignal), deadline },
    );
    expect(s.results()[0]?.result).toEqual({ status: "applied", state: STATE });
    expect(RelayResponse.parse(s.results()[0])).toBeTruthy();
  });

  it.each([
    ["another panel", { panelId: OTHER }],
    ["another generation", { generation: GEN2 }],
    ["another protocol", { protocol: 2 }],
    ["an unreadable request id", { requestId: "nope" }],
    ["an unknown message", { type: "launch" }],
  ])("drops a command for %s without a reply", async (_, extra) => {
    const { relay, controller, ready } = setup();
    relay.start(PANEL);
    const s = await ready();
    s.say(command({ operation: "navigate", args: { tab: "logs" }, ...extra }));
    await tick();
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(s.results()).toEqual([]);
  });

  it("takes nothing from a socket the gateway has not greeted", async () => {
    const { relay, controller, socket } = setup();
    relay.start(PANEL);
    const s = await socket();
    s.say(command({ operation: "navigate", args: { tab: "logs" } }));
    await tick();
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(s.sent).toEqual([]);
  });

  it("carries out a request once, however often it comes", async () => {
    const { relay, controller, ready } = setup();
    relay.start(PANEL);
    const s = await ready();
    s.say(command({ operation: "navigate", args: {} }));
    s.say(command({ operation: "navigate", args: {} }));
    await vi.waitFor(() => expect(s.results()).toHaveLength(1));
    await tick();
    expect(controller.navigate).toHaveBeenCalledOnce();
    expect(s.results()).toHaveLength(1);
  });

  it.each([
    ["an unknown operation", { operation: "delete_files" }, "Unknown operation."],
    ["get_state with arguments", { args: { tab: "logs" } }, "get_state takes no arguments."],
    [
      "navigate outside the workspace",
      { operation: "navigate", args: { path: "../secret" } },
      "relative to the workspace",
    ],
    ["navigate with unknown fields", { operation: "navigate", args: { x: 1 } }, "Unknown field x."],
  ])("refuses %s with an error and the state", async (_, extra, message) => {
    const { relay, controller, ready } = setup();
    relay.start(PANEL);
    const s = await ready();
    s.say(command(extra));
    await vi.waitFor(() => expect(s.results()).toHaveLength(1));
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(s.results()[0]?.result).toMatchObject({
      status: "error",
      message: expect.stringContaining(message),
      state: STATE,
    });
  });

  it("aborts a cancelled navigation and does not answer it", async () => {
    let seen: AbortSignal | undefined;
    const { relay, ready } = setup(
      (_, { signal }) =>
        new Promise((resolve) => {
          seen = signal;
          signal?.addEventListener("abort", () => resolve({ status: "cancelled", state: STATE }));
        }),
    );
    relay.start(PANEL);
    const s = await ready();
    s.say(command({ operation: "navigate", args: { tab: "logs" } }));
    await vi.waitFor(() => expect(relay.get().busy).toBe(1));
    s.say({ type: "cancel", protocol: 1, requestId: REQ, generation: GEN });
    await vi.waitFor(() => expect(relay.get().busy).toBe(0));
    expect(seen?.aborted).toBe(true);
    expect(s.results()).toEqual([]);
  });

  it("does not answer a navigation that finished after its deadline", async () => {
    const { relay, ready } = setup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: "applied", state: STATE };
    });
    relay.start(PANEL);
    const s = await ready();
    s.say(command({ operation: "navigate", args: {}, deadline: Date.now() + 10 }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(s.results()).toEqual([]);
  });

  it("reconnects with a fresh ticket when the socket drops, ending what it was doing", async () => {
    let seen: AbortSignal | undefined;
    const { relay, ticket, ready, sockets } = setup(
      (_, { signal }) =>
        new Promise((resolve) => {
          seen = signal;
          setTimeout(() => resolve({ status: "applied", state: STATE }), 20);
        }),
    );
    relay.start(PANEL);
    const first = await ready();
    first.say(command({ operation: "navigate", args: {} }));
    await vi.waitFor(() => expect(relay.get().busy).toBe(1));
    first.drop();
    expect(seen?.aborted).toBe(true);
    expect(relay.get().status).toBe("reconnecting");
    const second = await ready(GEN2, 1);
    expect(ticket).toHaveBeenCalledTimes(2);
    expect(sockets[1]?.url.toString()).toContain("ticket=t2");
    expect(relay.get().status).toBe("connected");
    await new Promise((resolve) => setTimeout(resolve, 40));
    // The old generation's work is answered nowhere.
    expect(first.results()).toEqual([]);
    expect(second.results()).toEqual([]);
    // And the old generation's commands are no longer taken.
    second.say(command({ requestId: REQ2 }));
    await tick();
    expect(second.results()).toEqual([]);
  });

  it("retries a refused ticket, later each time", async () => {
    const { relay, ticket, ready } = setup();
    ticket.mockRejectedValueOnce(new Error("Exeora is restarting."));
    relay.start(PANEL);
    await vi.waitFor(() =>
      expect(relay.get()).toMatchObject({
        status: "reconnecting",
        message: "Exeora is restarting.",
      }),
    );
    await ready();
    expect(relay.get().status).toBe("connected");
  });

  it("stops at the person's word, ending the work under way, and resumes on theirs", async () => {
    let seen: AbortSignal | undefined;
    const { relay, controller, ticket, ready, sockets } = setup(
      (_, { signal }) =>
        new Promise((resolve) => {
          seen = signal;
          signal?.addEventListener("abort", () => resolve({ status: "cancelled", state: STATE }));
        }),
    );
    relay.start(PANEL);
    const s = await ready();
    s.say(command({ operation: "navigate", args: {} }));
    await vi.waitFor(() => expect(relay.get().busy).toBe(1));
    relay.stop();
    expect(controller.stopModel).toHaveBeenCalledOnce();
    expect(seen?.aborted).toBe(true);
    expect(s.closed).toBe(true);
    expect(relay.get()).toMatchObject({ status: "stopped", busy: 0 });
    await tick();
    expect(sockets).toHaveLength(1);
    expect(s.results()).toEqual([]);
    // A later opening does not undo the person's Stop.
    relay.start(OTHER);
    await tick();
    expect(sockets).toHaveLength(1);

    relay.resume();
    await ready(GEN2, 1);
    expect(ticket).toHaveBeenLastCalledWith(OTHER);
    expect(relay.get().status).toBe("connected");
  });

  it("fails closed on another protocol, and does not reconnect", async () => {
    const { relay, socket, sockets } = setup();
    relay.start(PANEL);
    const s = await socket();
    s.say({ type: "ready", protocol: 2, panelId: PANEL, generation: GEN });
    expect(relay.get().status).toBe("unavailable");
    expect(relay.get().message).toContain("Reopen the Workspace");
    expect(s.closed).toBe(true);
    await tick();
    expect(sockets).toHaveLength(1);
  });

  it("fails closed on a greeting for another panel", async () => {
    const { relay, socket } = setup();
    relay.start(PANEL);
    const s = await socket();
    s.say({ type: "ready", protocol: 1, panelId: OTHER, generation: GEN });
    expect(relay.get().status).toBe("unavailable");
  });

  it("moves to a new address when a later opening names another panel", async () => {
    const { relay, ticket, ready, sockets } = setup();
    relay.start(PANEL);
    const first = await ready();
    relay.start(PANEL);
    expect(sockets).toHaveLength(1);
    relay.start(OTHER);
    expect(first.closed).toBe(true);
    await ready(GEN2, 1);
    expect(ticket).toHaveBeenLastCalledWith(OTHER);
    expect(relay.get().panelId).toBe(OTHER);
  });

  it("never opens a relay address on another origin", async () => {
    const relay = new PanelRelay({
      controller: { state: () => STATE, navigate: vi.fn() },
      ticket: async () => ({
        panelId: PANEL,
        protocol: 1,
        url: "https://evil.test/x",
        expiresAt: 1,
      }),
      socketUrl: () => undefined,
      open: () => {
        throw new Error("opened");
      },
    });
    relay.start(PANEL);
    await vi.waitFor(() => expect(relay.get().status).toBe("unavailable"));
  });

  it("closes everything for good once disposed, the model's work under way included", async () => {
    let seen: AbortSignal | undefined;
    const { relay, controller, ready, sockets, ticket } = setup(
      (_, { signal }) =>
        new Promise((resolve) => {
          seen = signal;
          signal?.addEventListener("abort", () => resolve({ status: "cancelled", state: STATE }));
        }),
    );
    relay.start(PANEL);
    const s = await ready();
    s.say(command({ operation: "navigate", args: {} }));
    await vi.waitFor(() => expect(relay.get().busy).toBe(1));
    relay.dispose();
    expect(s.closed).toBe(true);
    expect(seen?.aborted).toBe(true);
    expect(controller.stopModel).toHaveBeenCalledOnce();
    expect(relay.get()).toMatchObject({ status: "closed", busy: 0 });
    relay.resume();
    relay.start(OTHER);
    relay.stop();
    await tick();
    expect(sockets).toHaveLength(1);
    expect(ticket).toHaveBeenCalledOnce();
    expect(relay.get().status).toBe("closed");
    expect(s.results()).toEqual([]);
  });

  it("pings while connected", async () => {
    const sockets: FakeSocket[] = [];
    const relay = new PanelRelay({
      controller: { state: () => STATE, navigate: vi.fn() },
      ticket: async () => ({ panelId: PANEL, protocol: 1, url: "https://gw.test/r", expiresAt: 1 }),
      socketUrl: (url) => new URL(url),
      open: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      pingMs: 5,
    });
    relay.start(PANEL);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]?.say({ type: "ready", protocol: 1, panelId: PANEL, generation: GEN });
    await vi.waitFor(() =>
      expect(sockets[0]?.sent.some((message) => message.type === "ping")).toBe(true),
    );
    relay.dispose();
  });
  it.each([
    [1000, "Replaced by this instance new connection", "newer connection"],
    [1000, "Panel registration expired", "registration with Exeora expired"],
    [1008, "invalid protocol", "Reopen the Workspace"],
  ])("does not reconnect once the gateway closes with %i (%s)", async (code, reason, message) => {
    const { relay, ready, sockets } = setup();
    relay.start(PANEL);
    const s = await ready();
    s.readyState = 3;
    s.onclose?.({ code, reason });
    expect(relay.get().status).toBe("unavailable");
    expect(relay.get().message).toContain(message);
    await tick();
    expect(sockets).toHaveLength(1);
  });
});
