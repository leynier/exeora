import {
  BASELINE_CAPABILITIES,
  CHATGPT_V1,
  decodeRelayMessage,
  type ExecutorCapabilities,
  type WorkspaceAction,
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
import { decodeCallerResponse } from "./relay-internal.js";

beforeEach(freshRelay);

const CHATGPT_CAPABILITIES: ExecutorCapabilities = {
  ...BASELINE_CAPABILITIES,
  features: [CHATGPT_V1],
  workspaceRouting: true,
};

const statusAction = (): WorkspaceAction => ({ action: "chatgpt_status" });

describe("ChatGPT workspace relay", () => {
  it("requires chatgpt-v1 before dispatching and names the ChatGPT tab", async () => {
    const executor = await attachFakeExecutor({ capabilities: BASELINE_CAPABILITIES });
    const error = await failureOf(() =>
      callRelayWorkspace(relay(), {
        requestId: "req_chatgpt_old_cli",
        projectId: "chatgpt",
        action: statusAction(),
      }),
    );

    expect(error.code).toBe("FORBIDDEN");
    expect((error as { message?: string }).message).toBe(
      "Update the Exeora CLI on this machine to use ChatGPT.",
    );
    expect(executor.workspaceSeen).toEqual([]);
    executor.socket.close(1000, "done");
  });

  it("negotiates chatgpt-v1 and routes device actions through the placeholder project", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CHATGPT_CAPABILITIES,
      workspaceFrame: (requestId) => ({
        type: "workspace.result",
        requestId,
        durationMs: 1,
        result: {
          ok: true,
          value: { kind: "chatgpt_status", state: "signed_out" },
        },
      }),
    });
    const projectIds: string[] = [];
    executor.socket.addEventListener("message", (event: MessageEvent) => {
      const message = decodeRelayMessage(String(event.data));
      if (message?.type === "workspace.call") projectIds.push(message.projectId);
    });

    const value = await callRelayWorkspace(relay(), {
      requestId: "req_chatgpt_status",
      projectId: "chatgpt",
      action: statusAction(),
    });

    expect(value).toEqual({ kind: "chatgpt_status", state: "signed_out" });
    expect(projectIds).toEqual(["chatgpt"]);
    expect(executor.workspaceSeen).toEqual([
      { requestId: "req_chatgpt_status", action: { action: "chatgpt_status" } },
    ]);
    executor.socket.close(1000, "done");
  });

  it("rejects an authorize URL carrying credential material at the relay decoder", async () => {
    const secretUrl = "https://auth.openai.com/api/accounts/authorize?id_token_hint=secret";
    const raw = JSON.stringify({
      type: "workspace.result",
      requestId: "req_chatgpt_secret_url",
      durationMs: 1,
      result: {
        ok: true,
        value: {
          kind: "chatgpt_login",
          authorizeUrl: secretUrl,
          expiresAt: Date.now() + 600_000,
        },
      },
    });
    expect(decodeCallerResponse(raw)).toBeNull();

    const executor = await attachFakeExecutor({
      capabilities: CHATGPT_CAPABILITIES,
      workspaceFrame: () => JSON.parse(raw),
    });
    const error = await failureOf(() =>
      callRelayWorkspace(relay(), {
        requestId: "req_chatgpt_secret_url",
        projectId: "chatgpt",
        action: { action: "chatgpt_login_start", mode: "new" },
      }),
    );

    expect(error.code).toBe("INTERNAL_ERROR");
    expect(executor.workspaceSeen).toHaveLength(1);
    executor.socket.close(1000, "done");
  });

  it("cancels an in-flight ChatGPT action and cleans up the relay caller", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CHATGPT_CAPABILITIES,
      silent: true,
    });
    const controller = new AbortController();
    const pending = failureOf(() =>
      callRelayWorkspace(relay(), {
        requestId: "req_chatgpt_cancel",
        projectId: "chatgpt",
        action: {
          action: "chatgpt_generate",
          instructions: "Write a commit message.",
          input: "A staged patch.",
        },
        signal: controller.signal,
      }),
    );
    await eventually(() => expect(executor.workspaceSeen).toHaveLength(1));

    controller.abort();

    expect((await pending).code).toBe("CANCELLED");
    await eventually(() => expect(executor.cancelled).toEqual(["req_chatgpt_cancel"]));
    executor.socket.close(1000, "done");
  });
});
