import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridge, framingExtension } from "./bridge.js";
import type { PanelMessage } from "./protocol.js";

const SHELL = "chrome-extension://helnfgncjgikiojakjdfppmmflbdjamo";

type Handler = (event: { data: unknown; origin: string; source: unknown }) => void;

/** A parent window that records what the panel sent, and a way to answer it. */
function world() {
  const sent: PanelMessage[] = [];
  const targets: string[] = [];
  let handler: Handler | undefined;
  const parent = {
    postMessage(message: unknown, targetOrigin: string) {
      sent.push(message as PanelMessage);
      targets.push(targetOrigin);
    },
  };
  const bridge = createBridge({
    parent,
    parentOrigin: SHELL,
    listen: (next) => {
      handler = next as Handler;
      return () => {
        handler = undefined;
      };
    },
  });
  const deliver = (data: unknown, origin = SHELL, source: unknown = parent) =>
    handler?.({ data, origin, source });
  return { bridge, sent, targets, deliver, parent, listening: () => handler !== undefined };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the panel's bridge", () => {
  it("asks the parent, and only at the extension's origin", async () => {
    const { bridge, sent, targets, deliver } = world();
    const token = bridge.request({ kind: "token" });

    expect(sent).toEqual([{ exeora: "panel", id: 1, request: { kind: "token" } }]);
    expect(targets).toEqual([SHELL]);

    deliver({ exeora: "shell", id: 1, ok: true, result: { token: "abc" } });
    await expect(token).resolves.toEqual({ token: "abc" });
  });

  it("matches answers to questions by id", async () => {
    const { bridge, deliver } = world();
    const first = bridge.request({ kind: "token" });
    const second = bridge.request({ kind: "token", force: true });

    deliver({ exeora: "shell", id: 2, ok: true, result: { token: "two" } });
    deliver({ exeora: "shell", id: 1, ok: true, result: { token: "one" } });

    await expect(first).resolves.toEqual({ token: "one" });
    await expect(second).resolves.toEqual({ token: "two" });
  });

  it("ignores a reply from another origin or another window", async () => {
    vi.useFakeTimers();
    const { bridge, deliver } = world();
    const token = bridge.request({ kind: "token" });
    const settled = vi.fn();
    token.then(settled, settled);

    deliver({ exeora: "shell", id: 1, ok: true, result: { token: "evil" } }, "https://evil.test");
    deliver({ exeora: "shell", id: 1, ok: true, result: { token: "evil" } }, SHELL, {});
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    deliver({ exeora: "shell", id: 1, ok: true, result: { token: "good" } });
    await expect(token).resolves.toEqual({ token: "good" });
  });

  it("rejects with the shell's sentence", async () => {
    const { bridge, deliver } = world();
    const open = bridge.request({ kind: "open", path: "/projects" });
    deliver({ exeora: "shell", id: 1, ok: false, error: "No." });
    await expect(open).rejects.toThrow("No.");
  });

  it("gives up on a shell that never answers", async () => {
    vi.useFakeTimers();
    const { bridge } = world();
    const ready = bridge.request({ kind: "ready" });
    vi.advanceTimersByTime(5_000);
    await expect(ready).rejects.toThrow("did not answer");
  });

  it("stops listening and fails what is pending when closed", async () => {
    const { bridge, listening } = world();
    const token = bridge.request({ kind: "token" });
    bridge.close();
    expect(listening()).toBe(false);
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
