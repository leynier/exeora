import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  BASELINE_CAPABILITIES,
  decodeRelayMessage,
  type ExecutorCapabilities,
  encodeMessage,
} from "@exeora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { attachFakeExecutor, eventually, freshRelay, relay } from "./relay-do-fixtures.js";
import {
  type StoredTerminalSession,
  TERMINAL_IDLE_MS,
  TERMINAL_SESSION_PREFIX,
} from "./relay-do-terminal-sessions.js";

beforeEach(freshRelay);

const CAPABILITIES: ExecutorCapabilities = {
  ...BASELINE_CAPABILITIES,
  features: ["source-control-v1", "terminal-v1"],
  workspaceRouting: true,
};

/** A CLI that opens every requested terminal and records what it was sent. */
async function terminalExecutor() {
  const executor = await attachFakeExecutor({ capabilities: CAPABILITIES });
  await executor.ack;
  const frames: Array<{ type: string; sessionId?: string }> = [];
  executor.socket.addEventListener("message", (event: MessageEvent) => {
    const message = decodeRelayMessage(String(event.data));
    if (!message?.type.startsWith("terminal.")) return;
    frames.push(message as { type: string; sessionId?: string });
    if (message.type === "terminal.open") {
      executor.socket.send(
        encodeMessage({ type: "terminal.opened", sessionId: message.sessionId }),
      );
    }
  });
  const types = () => frames.map((frame) => frame.type);
  return { ...executor, frames, types };
}

async function openViewer(id: string, workspace = "") {
  const response = await relay().fetch(
    new Request(
      `https://relay/caller/terminal?id=${id}&projectId=prj_test${workspace}&cols=80&rows=24`,
      { headers: { Upgrade: "websocket" } },
    ),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("terminal socket was not returned");
  const frames: Array<{ type: string; message?: string; data?: string }> = [];
  let closed = false;
  socket.accept();
  socket.addEventListener("message", (event: MessageEvent) => {
    frames.push(JSON.parse(String(event.data)));
  });
  socket.addEventListener("close", () => {
    closed = true;
  });
  await eventually(() => expect(frames.map((frame) => frame.type)).toContain("terminal.opened"));
  return { socket, frames, types: () => frames.map((frame) => frame.type), isClosed: () => closed };
}

/** Moves every stored row's activity back, as if nobody had touched it. */
async function backdateStoredSessions(by: number) {
  await runInDurableObject(relay(), async (_instance, state) => {
    const rows = await state.storage.list<StoredTerminalSession>({
      prefix: TERMINAL_SESSION_PREFIX,
    });
    for (const [key, row] of rows) {
      await state.storage.put(key, { ...row, lastActivityAt: row.lastActivityAt - by });
    }
  });
}

describe("terminal sessions", () => {
  it("keeps an attached terminal in use alive, and expires it once it is idle", async () => {
    const executor = await terminalExecutor();
    const viewer = await openViewer("term_busy");

    // The stored row is only written on attach and detach; typing while
    // attached touches the socket. The row alone would look idle here.
    await backdateStoredSessions(TERMINAL_IDLE_MS + 60_000);
    viewer.socket.send(
      encodeMessage({ type: "terminal.input", sessionId: "term_busy", data: "bHMK" }),
    );
    await eventually(() => expect(executor.types()).toContain("terminal.input"));
    await runDurableObjectAlarm(relay());

    expect(viewer.types()).not.toContain("terminal.error");
    expect(executor.types()).not.toContain("terminal.close");
    expect(await relay().listTerminals()).toHaveLength(1);

    await runInDurableObject(relay(), async (_instance, state) => {
      for (const socket of state.getWebSockets("terminal")) {
        const attachment = socket.deserializeAttachment() as { lastActivityAt: number };
        socket.serializeAttachment({
          ...attachment,
          lastActivityAt: attachment.lastActivityAt - TERMINAL_IDLE_MS - 60_000,
        });
      }
    });
    await runDurableObjectAlarm(relay());

    await eventually(() => expect(viewer.types()).toContain("terminal.error"));
    await eventually(() => expect(executor.types()).toContain("terminal.close"));
    expect(await relay().listTerminals()).toEqual([]);
    executor.socket.close(1000, "done");
  });

  it("hands the terminal to the newest viewer without closing the shell", async () => {
    const executor = await terminalExecutor();
    const first = await openViewer("term_first");
    const second = await openViewer("term_second");

    await eventually(() => expect(first.types()).toContain("terminal.detached"));
    await eventually(() => expect(first.isClosed()).toBe(true));
    expect(first.types()).not.toContain("terminal.error");
    // Reattaching asks the CLI to open the same session again, which attaches
    // to its shell for that root rather than starting a second one.
    const opens = executor.frames.filter((frame) => frame.type === "terminal.open");
    expect(opens.map((frame) => frame.sessionId)).toEqual(["term_first", "term_first"]);
    expect(executor.types()).not.toContain("terminal.close");

    second.socket.send(
      encodeMessage({ type: "terminal.input", sessionId: "term_first", data: "bHMK" }),
    );
    await eventually(() => expect(executor.types()).toContain("terminal.input"));
    expect(await relay().listTerminals()).toEqual([
      expect.objectContaining({ sessionId: "term_first" }),
    ]);
    executor.socket.close(1000, "done");
  });

  it("keeps detached output written in batches, and replays all of it on reattach", async () => {
    const executor = await terminalExecutor();
    const viewer = await openViewer("term_quiet");
    viewer.socket.close(1000, "reload");
    await eventually(async () => {
      await runInDurableObject(relay(), async (_instance, state) => {
        expect(state.getWebSockets("terminal")).toHaveLength(0);
      });
    });

    for (const data of ["b25lCg==", "dHdvCg==", "dGhyZWUK"]) {
      executor.socket.send(
        encodeMessage({ type: "terminal.output", sessionId: "term_quiet", data }),
      );
    }
    await eventually(async () => {
      await runInDurableObject(relay(), async (_instance, state) => {
        const rows = await state.storage.list<StoredTerminalSession>({
          prefix: TERMINAL_SESSION_PREFIX,
        });
        // The first chunk is written; the rest wait in memory for the window.
        expect([...rows.values()][0]?.replay).toEqual(["b25lCg=="]);
      });
    });
    // Output then stops. The trailing alarm writes the rest without waiting
    // for a reattach, since hibernation would drop the in-memory copy.
    await eventually(async () => {
      await runDurableObjectAlarm(relay());
      await runInDurableObject(relay(), async (_instance, state) => {
        const rows = await state.storage.list<StoredTerminalSession>({
          prefix: TERMINAL_SESSION_PREFIX,
        });
        expect([...rows.values()][0]?.replay).toEqual(["b25lCg==", "dHdvCg==", "dGhyZWUK"]);
      });
    });

    const again = await openViewer("term_again");
    await eventually(() =>
      expect(again.frames.filter((frame) => frame.type === "terminal.output")).toHaveLength(3),
    );
    executor.socket.close(1000, "done");
  });

  it("forgets every terminal when a new CLI process says hello", async () => {
    const stale = await terminalExecutor();
    const detached = await openViewer("term_detached");
    detached.socket.close(1000, "reload");
    const attached = await openViewer("term_attached", "&workspaceId=wsp_a&workspaceSlug=a");
    await eventually(async () => expect(await relay().listTerminals()).toHaveLength(2));

    const current = await terminalExecutor();
    await eventually(() => expect(attached.types()).toContain("terminal.error"));
    expect(await relay().listTerminals()).toEqual([]);

    // The replaced socket's close arrives late. It must not take down a
    // terminal the new process has opened in the meantime.
    const fresh = await openViewer("term_fresh");
    stale.socket.close(1000, "gone");
    await eventually(async () => {
      await runInDurableObject(relay(), async (_instance, state) => {
        expect(state.getWebSockets("executor")).toHaveLength(1);
      });
    });
    expect(fresh.types()).not.toContain("terminal.error");
    expect(await relay().listTerminals()).toEqual([
      expect.objectContaining({ sessionId: "term_fresh" }),
    ]);
    current.socket.close(1000, "done");
  });

  it("tells attached viewers when the machine drops, and forgets its sessions", async () => {
    const executor = await terminalExecutor();
    const viewer = await openViewer("term_dropped");

    executor.socket.close(1000, "offline");

    await eventually(() => expect(viewer.types()).toContain("terminal.error"));
    await eventually(async () => expect(await relay().listTerminals()).toEqual([]));
  });

  it("closes a session from the dashboard even with no viewer attached", async () => {
    const executor = await terminalExecutor();
    const detached = await openViewer("term_orphan");
    detached.socket.close(1000, "reload");
    const viewer = await openViewer("term_shown", "&workspaceId=wsp_b&workspaceSlug=b");

    expect(await relay().closeTerminal("prj_test", undefined)).toBe(true);
    expect(await relay().closeTerminal("prj_test", "wsp_b")).toBe(true);

    await eventually(() =>
      expect(executor.frames.filter((frame) => frame.type === "terminal.close")).toHaveLength(2),
    );
    await eventually(() => expect(viewer.types()).toContain("terminal.exit"));
    expect(await relay().listTerminals()).toEqual([]);
    expect(await relay().closeTerminal("prj_test", undefined)).toBe(false);
    executor.socket.close(1000, "done");
  });
});
