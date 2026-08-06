import { env } from "cloudflare:test";
import {
  decodeRelayMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ToolResultMessage,
} from "@exeora/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The relay under workerd, so hibernation, WebSocketPair and D1 behave as they
 * will in production.
 */

/**
 * A fresh Durable Object per test. Reusing one leaks sockets between tests:
 * a socket closed in `beforeEach` is still listed by getWebSockets() for a
 * moment, so the next test starts "online" and sends into a dead socket.
 */
let relayName: string;

function relay() {
  return env.DEVICE_RELAY.getByName(relayName);
}

/**
 * Awaits an RPC call that is expected to fail and returns the error.
 *
 * Not `expect(promise).rejects`: a Durable Object stub returns a pipelining
 * proxy rather than a plain promise, and asserting on it directly leaves an
 * internal promise unobserved, which vitest then reports as an unhandled
 * rejection even though the test passed.
 */
async function failureOf(call: () => Promise<unknown>): Promise<{ code?: string }> {
  try {
    await call();
  } catch (error) {
    return error as { code?: string };
  }
  throw new Error("expected the call to fail, but it resolved");
}

/** Opens the executor socket the way the Worker does: over fetch, not RPC. */
async function dial() {
  const response = await relay().fetch(
    new Request("https://relay/connect?deviceId=dev_test", {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  return socket;
}

/**
 * Stands in for the CLI: dials the object, answers `tool.call` with whatever
 * the test tells it to.
 */
async function attachFakeExecutor(
  options: {
    respond?: (call: {
      requestId: string;
      tool: string;
      args: unknown;
    }) => ToolResultMessage["result"];
    silent?: boolean;
  } = {},
) {
  const socket = await dial();

  const seen: Array<{ requestId: string; tool: string; args: unknown }> = [];

  socket.addEventListener("message", (event: MessageEvent) => {
    const message = decodeRelayMessage(String(event.data));
    if (message?.type !== "tool.call") return;

    const call = { requestId: message.requestId, tool: message.tool, args: message.arguments };
    seen.push(call);
    if (options.silent) return;

    socket.send(
      encodeMessage({
        type: "tool.result",
        requestId: message.requestId,
        durationMs: 1,
        result: options.respond?.(call) ?? { ok: true, value: { echoed: call.args } },
      }),
    );
  });

  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: "dev_test",
      cliVersion: "0.1.0",
      platform: "linux",
      projects: [{ id: "prj_test", slug: "test" }],
    }),
  );

  return { socket, seen };
}

beforeEach(() => {
  relayName = `usr_test:dev_${crypto.randomUUID()}`;
});

describe("presence", () => {
  it("reports offline with no executor attached", async () => {
    expect(await relay().isOnline()).toBe(false);
  });

  it("reports online once the executor dials in", async () => {
    await attachFakeExecutor();
    expect(await relay().isOnline()).toBe(true);
  });
});

describe("callTool", () => {
  it("fails immediately when no executor is connected, rather than queueing", async () => {
    const error = await failureOf(() =>
      relay().callTool({ requestId: "req_1", projectId: "prj_test", tool: "read_file", args: {} }),
    );
    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
  });

  it("forwards the call and returns the executor's value", async () => {
    const executor = await attachFakeExecutor();

    const value = await relay().callTool({
      requestId: "req_2",
      projectId: "prj_test",
      tool: "read_file",
      args: { path: "src/main.ts" },
    });

    expect(value).toEqual({ echoed: { path: "src/main.ts" } });
    expect(executor.seen[0]).toMatchObject({ tool: "read_file", requestId: "req_2" });
  });

  it("propagates an executor error with its code intact", async () => {
    const executor = await attachFakeExecutor({
      respond: () => ({
        ok: false,
        error: { code: "PATH_ESCAPE", message: "outside the project root" },
      }),
    });

    const error = await failureOf(() =>
      relay().callTool({
        requestId: "req_3",
        projectId: "prj_test",
        tool: "read_file",
        args: { path: "../../etc/passwd" },
      }),
    );
    expect(error.code).toBe("PATH_ESCAPE");
    executor.socket.close(1000, "done");
  });

  it("keeps concurrent calls apart", async () => {
    await attachFakeExecutor({ respond: (call) => ({ ok: true, value: call.requestId }) });

    const results = await Promise.all(
      ["a", "b", "c"].map((id) =>
        relay().callTool({ requestId: id, projectId: "prj_test", tool: "grep", args: {} }),
      ),
    );

    expect(results).toEqual(["a", "b", "c"]);
  });

  it("sends a deadline the executor can use to drop a stale call", async () => {
    const executor = await attachFakeExecutor({ silent: true });
    // Never answered, so it rejects at the deadline long after this test ends.
    // Caught so the rejection is not reported as unhandled.
    void failureOf(() =>
      relay().callTool({
        requestId: "req_4",
        projectId: "prj_test",
        tool: "read_file",
        args: {},
      }),
    );

    await vi.waitFor(() => expect(executor.seen).toHaveLength(1));
    executor.socket.close(1000, "done");
  });
});

describe("disconnection", () => {
  it("fails an in-flight call when the executor drops", async () => {
    const executor = await attachFakeExecutor({ silent: true });

    const pending = failureOf(() =>
      relay().callTool({
        requestId: "req_5",
        projectId: "prj_test",
        tool: "run_command",
        args: {},
      }),
    );
    await vi.waitFor(() => expect(executor.seen).toHaveLength(1));

    executor.socket.close(1000, "gone");
    expect((await pending).code).toBe("LOCAL_EXECUTOR_OFFLINE");
  });
});

describe("revocation", () => {
  it("closes the socket so a revoked device stops serving at once", async () => {
    const executor = await attachFakeExecutor();
    expect(await relay().isOnline()).toBe(true);

    const closed = new Promise<number>((resolve) => {
      executor.socket.addEventListener("close", (event: CloseEvent) => resolve(event.code));
    });

    await relay().revoke();

    expect(await closed).toBe(1008);
    expect(await relay().isOnline()).toBe(false);
  });
});

describe("protocol version", () => {
  it("refuses a CLI speaking a different version instead of misreading its frames", async () => {
    const socket = await dial();

    const closed = new Promise<number>((resolve) => {
      socket.addEventListener("close", (event: CloseEvent) => resolve(event.code));
    });

    socket.send(
      encodeMessage({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION + 1,
        deviceId: "dev_test",
        cliVersion: "99.0.0",
        platform: "linux",
        projects: [],
      }),
    );

    expect(await closed).toBe(1008);
  });
});
