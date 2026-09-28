import { afterEach, describe, expect, it, vi } from "vitest";
import { createShell, type ShellDeps } from "./bridge.js";

const GATEWAY = "https://exeora.test";

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** A shell and the frame it serves, with the panel's end of a connected port. */
function world(overrides: Partial<ShellDeps> = {}) {
  const frame = {};
  const deps: ShellDeps = {
    gateway: GATEWAY,
    frame: () => frame,
    token: vi.fn(async () => "access"),
    openTab: vi.fn(),
    signOut: vi.fn(async () => {}),
    onReady: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  };
  const shell = createShell(deps);
  const replies: unknown[] = [];

  /** What a panel document does: open a channel and hand the shell one port. */
  const connect = (origin = GATEWAY, source: unknown = frame) => {
    const channel = new MessageChannel();
    channels.push(channel);
    channel.port1.onmessage = (event: MessageEvent) => replies.push(event.data);
    shell.onMessage({
      data: { exeora: "panel", kind: "connect" },
      origin,
      source: source as MessageEventSource,
      ports: [channel.port2],
    });
    return channel.port1;
  };
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
  const ask = (port: MessagePort, request: unknown, id = 1) =>
    port.postMessage({ exeora: "panel", id, request });
  return { deps, shell, replies, connect, ask, settled };
}

describe("the shell", () => {
  it("answers ready with its protocol version, over the port", async () => {
    const { deps, replies, connect, ask } = world();
    ask(connect(), { kind: "ready" });
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(deps.onReady).toHaveBeenCalled();
    expect(replies).toEqual([{ exeora: "shell", id: 1, ok: true, result: { protocol: 1 } }]);
  });

  it("hands the token to the document that connected", async () => {
    const { deps, replies, connect, ask } = world();
    ask(connect(), { kind: "token", force: true }, 7);
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(deps.token).toHaveBeenCalledWith({ force: true });
    expect(replies).toEqual([{ exeora: "shell", id: 7, ok: true, result: { token: "access" } }]);
  });

  it("refuses a connection from another origin", async () => {
    const { deps, replies, connect, ask, settled } = world();
    ask(connect("https://evil.test"), { kind: "token" });
    await settled();
    expect(deps.token).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it("refuses a connection from a window other than its frame", async () => {
    const { deps, replies, connect, ask, settled } = world();
    ask(connect(GATEWAY, {}), { kind: "token" });
    await settled();
    expect(deps.token).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it("serves one document per load, not whatever the frame shows next", async () => {
    const { deps, replies, connect, ask, settled } = world();
    connect();
    ask(connect(), { kind: "token" });
    await settled();
    expect(deps.token).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it("asks to reload the panel once its document is gone, and stops answering", async () => {
    const { deps, connect, settled } = world();
    const port = connect();
    port.close();
    await vi.waitFor(() => expect(deps.onDisconnect).toHaveBeenCalled());
    await settled();
    expect(deps.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("asks to reload the panel when its document says it is leaving", async () => {
    const { deps, replies, connect, ask, settled } = world();
    const port = connect();
    port.postMessage({ exeora: "panel", kind: "bye" });
    await vi.waitFor(() => expect(deps.onDisconnect).toHaveBeenCalledTimes(1));
    ask(port, { kind: "token" });
    port.close();
    await settled();
    expect(deps.token).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
    expect(deps.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("does not ask to reload when the shell itself is being replaced", async () => {
    const { deps, shell, connect, settled } = world();
    connect();
    shell.dispose();
    await settled();
    expect(deps.onDisconnect).not.toHaveBeenCalled();
  });

  it("opens a path in the dashboard", async () => {
    const { deps, connect, ask } = world();
    ask(connect(), { kind: "open", path: "/projects/abc?tab=1" });
    await vi.waitFor(() => expect(deps.openTab).toHaveBeenCalled());
    expect(deps.openTab).toHaveBeenCalledWith(`${GATEWAY}/dashboard/projects/abc?tab=1`);
  });

  it.each(["https://evil.test/", "/../oauth/authorize", "/%2e%2e/oauth/authorize"])(
    "refuses to open %s",
    async (path) => {
      const { deps, replies, connect, ask } = world();
      ask(connect(), { kind: "open", path });
      await vi.waitFor(() => expect(replies).toHaveLength(1));
      expect(deps.openTab).not.toHaveBeenCalled();
      expect(replies[0]).toMatchObject({ ok: false, error: "Not a dashboard path." });
    },
  );

  it("signs out when asked", async () => {
    const { deps, connect, ask } = world();
    ask(connect(), { kind: "signOut" });
    await vi.waitFor(() => expect(deps.signOut).toHaveBeenCalled());
    expect(deps.signOut).toHaveBeenCalled();
  });

  it("tells a newer panel it does not know a request", async () => {
    const { replies, connect, ask } = world();
    ask(connect(), { kind: "somethingNew" });
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ ok: false, error: expect.stringContaining("Update") });
  });

  it("passes a failed refresh on as an error", async () => {
    const { replies, connect, ask } = world({
      token: async () => {
        throw new Error("Could not reach Exeora (503).");
      },
    });
    ask(connect(), { kind: "token" });
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ ok: false, error: "Could not reach Exeora (503)." });
  });
});
