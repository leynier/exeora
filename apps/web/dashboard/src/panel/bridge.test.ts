import { afterEach, describe, expect, it, vi } from "vitest";
import { type Bridge, createBridge, framingExtension } from "./bridge.js";
import type { PanelMessage } from "./protocol.js";

const SHELL = "chrome-extension://helnfgncjgikiojakjdfppmmflbdjamo";

/** A shell holding the port the panel handed it, answering whatever the test says. */
function world() {
  const received: PanelMessage[] = [];
  let shellPort: MessagePort | undefined;
  const bridge = createBridge({
    connect: (port) => {
      shellPort = port;
      port.onmessage = (event: MessageEvent) => received.push(event.data as PanelMessage);
    },
  });
  if (!shellPort) throw new Error("the bridge did not connect");
  const port = shellPort;
  const answer = (data: unknown) => port.postMessage(data);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  open.push({ bridge, port });
  return { bridge, received, answer, settle, port };
}

const open: Array<{ bridge: Bridge; port: MessagePort }> = [];

afterEach(() => {
  vi.useRealTimers();
  for (const { bridge, port } of open.splice(0)) {
    bridge.close();
    port.close();
  }
});

describe("the panel's bridge", () => {
  it("hands the shell a port once, and asks over it", async () => {
    const { bridge, received, answer, settle } = world();
    const token = bridge.request({ kind: "token" });
    await settle();

    expect(received).toEqual([{ exeora: "panel", id: 1, request: { kind: "token" } }]);
    answer({ exeora: "shell", id: 1, ok: true, result: { token: "abc" } });
    await expect(token).resolves.toEqual({ token: "abc" });
  });

  it("matches answers to questions by id", async () => {
    const { bridge, answer, settle } = world();
    const first = bridge.request({ kind: "token" });
    const second = bridge.request({ kind: "token", force: true });
    await settle();

    answer({ exeora: "shell", id: 2, ok: true, result: { token: "two" } });
    answer({ exeora: "shell", id: 1, ok: true, result: { token: "one" } });

    await expect(first).resolves.toEqual({ token: "one" });
    await expect(second).resolves.toEqual({ token: "two" });
  });

  it("ignores what is not an answer", async () => {
    const { bridge, answer, settle } = world();
    const token = bridge.request({ kind: "token" });
    const settled = vi.fn();
    token.then(settled, settled);

    answer({ id: 1, ok: true, result: { token: "not the shell" } });
    await settle();
    expect(settled).not.toHaveBeenCalled();

    answer({ exeora: "shell", id: 1, ok: true, result: { token: "good" } });
    await expect(token).resolves.toEqual({ token: "good" });
  });

  it("rejects with the shell's sentence", async () => {
    const { bridge, answer, settle } = world();
    const opened = bridge.request({ kind: "open", path: "/projects" });
    await settle();
    answer({ exeora: "shell", id: 1, ok: false, error: "No." });
    await expect(opened).rejects.toThrow("No.");
  });

  it("gives up on a shell that never answers", async () => {
    vi.useFakeTimers();
    const { bridge } = world();
    const ready = bridge.request({ kind: "ready" });
    vi.advanceTimersByTime(5_000);
    await expect(ready).rejects.toThrow("did not answer");
  });

  it("says bye over the port when its document leaves", async () => {
    const { bridge, received, settle } = world();
    bridge.leave();
    await settle();
    expect(received).toEqual([{ exeora: "panel", kind: "bye" }]);
  });

  it("fails what is pending when closed", async () => {
    const { bridge } = world();
    const token = bridge.request({ kind: "token" });
    bridge.close();
    await expect(token).rejects.toThrow("closed");
  });
});

describe("framingExtension", () => {
  const framed = (origins: string[]) => ({ parent: {}, location: { ancestorOrigins: origins } });

  it("is the extension framing the page", () => {
    expect(framingExtension(framed([SHELL]))).toBe(SHELL);
  });

  it("is null for a page framed by a website", () => {
    expect(framingExtension(framed(["https://evil.test"]))).toBeNull();
  });

  it("is null for a page in a tab of its own", () => {
    const win: { parent: unknown; location: { ancestorOrigins: string[] } } = {
      parent: undefined,
      location: { ancestorOrigins: [] },
    };
    win.parent = win;
    expect(framingExtension(win)).toBeNull();
  });
});
