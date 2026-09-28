import { BASELINE_CAPABILITIES } from "@exeora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { callRelayTool } from "./relay-client.js";
import { attachFakeExecutor, eventually, freshRelay, relay } from "./relay-do-fixtures.js";
import { type LogEvent, summarizeCall, summarizeMcpCall } from "./relay-do-logs.js";

beforeEach(freshRelay);

/** A dashboard tab watching the calls on one root or workspace. */
async function watch(id: string, target = "") {
  const response = await relay().fetch(
    new Request(`https://relay/caller/logs?id=${id}&projectId=prj_test${target}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("logs socket was not returned");
  const events: LogEvent[] = [];
  socket.accept();
  socket.addEventListener("message", (event: MessageEvent) => {
    events.push(JSON.parse(String(event.data)) as LogEvent);
  });
  return { socket, events };
}

const WORKSPACE = "&workspaceId=wsp_feature&workspaceSlug=feature";

describe("the live log of a machine's calls", () => {
  it("shows a call starting and ending to the tabs watching where it ran", async () => {
    await attachFakeExecutor();
    const root = await watch("logs_root");
    const elsewhere = await watch("logs_feature", WORKSPACE);

    await callRelayTool(relay(), {
      requestId: "req_git",
      projectId: "prj_test",
      tool: "run_command",
      args: { command: "git status --short", cwd: "apps/web" },
      client: { name: "claude-code", version: "2.1.0" },
    });

    await eventually(() => expect(root.events).toHaveLength(2));
    expect(root.events[0]).toMatchObject({
      type: "log.start",
      id: "req_git",
      kind: "tool",
      tool: "run_command",
      summary: "git status --short (in apps/web)",
      client: "claude-code 2.1.0",
    });
    expect(root.events[1]).toMatchObject({
      type: "log.end",
      id: "req_git",
      tool: "run_command",
      ok: true,
    });
    const end = root.events[1];
    expect(end?.type === "log.end" && end.durationMs >= 0).toBe(true);
    expect(elsewhere.events).toEqual([]);
  });

  it("names how a failed call ended", async () => {
    await attachFakeExecutor({
      capabilities: { ...BASELINE_CAPABILITIES, workspaceRouting: true },
      respond: () => ({ ok: false, error: { code: "TOOL_FAILED", message: "no such file" } }),
    });
    const tab = await watch("logs_fail", WORKSPACE);

    await callRelayTool(relay(), {
      requestId: "req_read",
      projectId: "prj_test",
      workspaceId: "wsp_feature",
      workspaceSlug: "feature",
      tool: "read_file",
      args: { path: "missing.txt" },
    }).catch(() => undefined);

    await eventually(() => expect(tab.events).toHaveLength(2));
    expect(tab.events[0]).toMatchObject({ type: "log.start", summary: "missing.txt" });
    expect(tab.events[1]).toMatchObject({ type: "log.end", ok: false, errorCode: "TOOL_FAILED" });
  });

  it("shows a tab opened mid-call what is running, and the call ending when it is cancelled", async () => {
    const executor = await attachFakeExecutor({ silent: true });
    const controller = new AbortController();
    const call = callRelayTool(relay(), {
      requestId: "req_long",
      projectId: "prj_test",
      tool: "run_command",
      args: { command: "bun test" },
      signal: controller.signal,
    }).catch(() => undefined);
    await eventually(() => expect(executor.seen).toHaveLength(1));

    const late = await watch("logs_late");
    await eventually(() =>
      expect(late.events).toEqual([expect.objectContaining({ type: "log.start", id: "req_long" })]),
    );

    controller.abort();
    await call;
    await eventually(() =>
      expect(late.events.at(-1)).toMatchObject({
        type: "log.end",
        id: "req_long",
        ok: false,
        errorCode: "CANCELLED",
      }),
    );
  });

  it("keeps nothing for a tab that was not open", async () => {
    await attachFakeExecutor();
    await callRelayTool(relay(), {
      requestId: "req_before",
      projectId: "prj_test",
      tool: "read_file",
      args: { path: "README.md" },
    });
    const tab = await watch("logs_after");
    // The call is over: nothing was written down for a tab to be sent later.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tab.events).toEqual([]);
  });

  it("issues a ticket to watch without a machine, and never one a terminal can spend", async () => {
    const ticket = await relay().createLogsTicket(
      "prj_test",
      undefined,
      undefined,
      "https://exeora.test",
    );
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    if (!ticket) return;
    expect(
      await relay().consumeTerminalTicket(
        ticket,
        "prj_test",
        undefined,
        undefined,
        "https://exeora.test",
      ),
    ).toBe(false);

    const second = await relay().createLogsTicket(
      "prj_test",
      undefined,
      undefined,
      "https://exeora.test",
    );
    if (!second) throw new Error("no second ticket");
    const spend = () =>
      relay().consumeTerminalTicket(
        second,
        "prj_test",
        undefined,
        undefined,
        "https://exeora.test",
        "logs",
      );
    expect(await spend()).toBe(true);
    expect(await spend()).toBe(false);
  });
});

describe("what a line says a call is about", () => {
  it("quotes the command, the process, the search, the path or the branch", () => {
    expect(summarizeCall("run_command", { command: "ls -la" })).toBe("ls -la");
    expect(summarizeCall("start_command", { command: "bun dev", cwd: "." })).toBe("bun dev");
    expect(summarizeCall("send_command_input", { processId: "p_1", input: "y" })).toBe(
      "process p_1",
    );
    expect(summarizeCall("grep", { pattern: "TODO", path: "src" })).toBe("TODO (in src)");
    expect(summarizeCall("write_file", { path: "a.ts", content: "secret body" })).toBe("a.ts");
    expect(summarizeCall("create_workspace", { branch: "feat/x" })).toBe("branch feat/x");
    expect(summarizeCall("list_workspaces", {})).toBe("");
  });

  it("keeps a line to one line of bounded length", () => {
    expect(summarizeCall("run_command", { command: "echo a\n  echo b" })).toBe("echo a echo b");
    const long = summarizeCall("run_command", { command: "x".repeat(1000) });
    expect(long.length).toBe(400);
    expect(long.endsWith("…")).toBe(true);
  });

  it("shows a proxied call's arguments, or nothing when it has none", () => {
    expect(summarizeMcpCall({ q: "weather" })).toBe('{"q":"weather"}');
    expect(summarizeMcpCall({})).toBe("");
  });
});
