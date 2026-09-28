import { describe, expect, it, vi } from "vitest";
import { createShell, type ShellDeps } from "./bridge.js";

const GATEWAY = "https://exeora.test";

/** A framed panel that records what the shell answered it. */
function world(overrides: Partial<ShellDeps> = {}) {
  const replies: Array<{ message: unknown; targetOrigin: string }> = [];
  const frame = {
    postMessage(message: unknown, targetOrigin: string) {
      replies.push({ message, targetOrigin });
    },
  };
  const deps: ShellDeps = {
    gateway: GATEWAY,
    frame: () => frame,
    token: vi.fn(async () => "access"),
    openTab: vi.fn(),
    signOut: vi.fn(async () => {}),
    onReady: vi.fn(),
    ...overrides,
  };
  const handle = createShell(deps);
  const send = (request: unknown, id = 1, origin = GATEWAY, source: unknown = frame) =>
    handle({
      data: { exeora: "panel", id, request },
      origin,
      source: source as MessageEventSource,
    });
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { deps, replies, send, settled };
}

describe("the shell", () => {
  it("answers ready with its protocol version", async () => {
    const { deps, replies, send, settled } = world();
    send({ kind: "ready" });
    await settled();
    expect(deps.onReady).toHaveBeenCalled();
    expect(replies).toEqual([
      {
        message: { exeora: "shell", id: 1, ok: true, result: { protocol: 1 } },
        targetOrigin: GATEWAY,
      },
    ]);
  });

  it("hands the token to the gateway's origin only", async () => {
    const { deps, replies, send, settled } = world();
    send({ kind: "token", force: true }, 7);
    await settled();
    expect(deps.token).toHaveBeenCalledWith({ force: true });
    expect(replies).toEqual([
      {
        message: { exeora: "shell", id: 7, ok: true, result: { token: "access" } },
        targetOrigin: GATEWAY,
      },
    ]);
  });

  it("ignores a message from another origin", async () => {
    const { deps, replies, send, settled } = world();
    send({ kind: "token" }, 1, "https://evil.test");
    await settled();
    expect(deps.token).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it("ignores a message from a window other than its frame", async () => {
    const { deps, replies, send, settled } = world();
    send({ kind: "token" }, 1, GATEWAY, {});
    await settled();
    expect(deps.token).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it("opens a path in the dashboard", async () => {
    const { deps, send, settled } = world();
    send({ kind: "open", path: "/projects/abc?tab=1" });
    await settled();
    expect(deps.openTab).toHaveBeenCalledWith(`${GATEWAY}/dashboard/projects/abc?tab=1`);
  });

  it("refuses to open anything but a dashboard path", async () => {
    const { deps, replies, send, settled } = world();
    send({ kind: "open", path: "https://evil.test/" });
    await settled();
    expect(deps.openTab).not.toHaveBeenCalled();
    expect(replies[0]?.message).toMatchObject({ ok: false, error: "Not a dashboard path." });
  });

  it("signs out when asked", async () => {
    const { deps, send, settled } = world();
    send({ kind: "signOut" });
    await settled();
    expect(deps.signOut).toHaveBeenCalled();
  });

  it("tells a newer panel it does not know a request", async () => {
    const { replies, send, settled } = world();
    send({ kind: "somethingNew" });
    await settled();
    expect(replies[0]?.message).toMatchObject({
      ok: false,
      error: expect.stringContaining("Update"),
    });
  });

  it("passes a failed refresh on as an error", async () => {
    const { replies, send, settled } = world({
      token: async () => {
        throw new Error("Could not reach Exeora (503).");
      },
    });
    send({ kind: "token" });
    await settled();
    expect(replies[0]?.message).toMatchObject({
      ok: false,
      error: "Could not reach Exeora (503).",
    });
  });
});
