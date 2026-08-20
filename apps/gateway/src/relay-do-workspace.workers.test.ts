import {
  BASELINE_CAPABILITIES,
  decodeRelayMessage,
  type ExecutorCapabilities,
  encodeMessage,
} from "@exeora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { callRelayWorkspace } from "./relay-client.js";
import {
  attachFakeExecutor,
  eventually,
  failureOf,
  freshRelay,
  relay,
} from "./relay-do-fixtures.js";

beforeEach(freshRelay);

describe("workspace relay", () => {
  const WORKSPACE_CAPABILITIES: ExecutorCapabilities = {
    ...BASELINE_CAPABILITIES,
    features: ["source-control-v1", "terminal-v1"],
    worktreeRouting: true,
  };

  it("negotiates the source-control feature and keeps its calls separate from tools", async () => {
    const executor = await attachFakeExecutor({ capabilities: WORKSPACE_CAPABILITIES });
    const value = await callRelayWorkspace(relay(), {
      requestId: "req_workspace",
      projectId: "prj_test",
      worktreeId: "wtr_feature",
      worktreeSlug: "feature",
      action: { action: "status" },
    });

    expect(value).toMatchObject({ kind: "status", repository: true, head: "main" });
    expect(executor.workspaceSeen).toEqual([
      {
        requestId: "req_workspace",
        worktreeId: "wtr_feature",
        worktreeSlug: "feature",
        action: { action: "status" },
      },
    ]);
    expect(executor.seen).toEqual([]);
  });

  it("requires a current CLI before dispatching source-control work", async () => {
    await attachFakeExecutor({ capabilities: BASELINE_CAPABILITIES });
    const error = await failureOf(() =>
      callRelayWorkspace(relay(), {
        requestId: "req_old_cli",
        projectId: "prj_test",
        action: { action: "status" },
      }),
    );

    expect(error.code).toBe("FORBIDDEN");
  });

  it("issues short-lived, origin-bound, one-time terminal tickets", async () => {
    await attachFakeExecutor({ capabilities: WORKSPACE_CAPABILITIES });
    const ticket = await relay().createTerminalTicket(
      "prj_test",
      undefined,
      undefined,
      "https://exeora.dev",
    );

    expect(ticket).toHaveLength(64);
    if (!ticket) throw new Error("ticket was not issued");
    expect(
      await relay().consumeTerminalTicket(
        ticket,
        "prj_test",
        undefined,
        undefined,
        "https://other.example",
      ),
    ).toBe(false);

    const worktreeTicket = await relay().createTerminalTicket(
      "prj_test",
      "wtr_feature",
      "feature",
      "https://exeora.dev",
    );
    if (!worktreeTicket) throw new Error("worktree ticket was not issued");
    expect(
      await relay().consumeTerminalTicket(
        worktreeTicket,
        "prj_test",
        "wtr_other",
        "other",
        "https://exeora.dev",
      ),
    ).toBe(false);
    expect(
      await relay().consumeTerminalTicket(
        ticket,
        "prj_test",
        undefined,
        undefined,
        "https://exeora.dev",
      ),
    ).toBe(false);

    const valid = await relay().createTerminalTicket(
      "prj_test",
      undefined,
      undefined,
      "https://exeora.dev",
    );
    if (!valid) throw new Error("ticket was not issued");
    expect(
      await relay().consumeTerminalTicket(
        valid,
        "prj_test",
        undefined,
        undefined,
        "https://exeora.dev",
      ),
    ).toBe(true);
    expect(
      await relay().consumeTerminalTicket(
        valid,
        "prj_test",
        undefined,
        undefined,
        "https://exeora.dev",
      ),
    ).toBe(false);
  });

  it("bridges terminal input and output without routing it through tool calls", async () => {
    const executor = await attachFakeExecutor({ capabilities: WORKSPACE_CAPABILITIES });
    await executor.ack;
    const executorFrames: string[] = [];
    executor.socket.addEventListener("message", (event: MessageEvent) => {
      const message = decodeRelayMessage(String(event.data));
      if (!message?.type.startsWith("terminal.")) return;
      executorFrames.push(message.type);
      if (message.type === "terminal.open") {
        executor.socket.send(
          encodeMessage({ type: "terminal.opened", sessionId: message.sessionId }),
        );
        executor.socket.send(
          encodeMessage({ type: "terminal.output", sessionId: message.sessionId, data: "b2sK" }),
        );
      }
    });

    const response = await relay().fetch(
      new Request("https://relay/caller/terminal?id=term_test&projectId=prj_test&cols=80&rows=24", {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(101);
    const browser = response.webSocket;
    if (!browser) throw new Error("terminal socket was not returned");
    const browserFrames: string[] = [];
    browser.accept();
    browser.addEventListener("message", (event: MessageEvent) => {
      browserFrames.push(JSON.parse(String(event.data)).type as string);
    });

    await eventually(() => expect(browserFrames).toEqual(["terminal.opened", "terminal.output"]));
    browser.send(
      encodeMessage({ type: "terminal.input", sessionId: "term_test", data: "cHdkCg==" }),
    );
    await eventually(() => expect(executorFrames).toContain("terminal.input"));
    expect(executor.seen).toEqual([]);

    const duplicate = await relay().fetch(
      new Request(
        "https://relay/caller/terminal?id=term_duplicate&projectId=prj_test&cols=80&rows=24",
        { headers: { Upgrade: "websocket" } },
      ),
    );
    expect(duplicate.status).toBe(409);

    const worktreeResponse = await relay().fetch(
      new Request(
        "https://relay/caller/terminal?id=term_worktree&projectId=prj_test&worktreeId=wtr_feature&worktreeSlug=feature&cols=80&rows=24",
        { headers: { Upgrade: "websocket" } },
      ),
    );
    expect(worktreeResponse.status).toBe(101);
    worktreeResponse.webSocket?.accept();
    worktreeResponse.webSocket?.close(1000, "done");

    browser.close(1000, "done");
    await eventually(() => expect(executorFrames).toContain("terminal.close"));
    executor.socket.close(1000, "done");
  });
});
