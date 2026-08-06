import { env } from "cloudflare:test";
import {
  type ApprovalRequestMessage,
  BASELINE_CAPABILITIES,
  decodeRelayMessage,
  type ExecutorCapabilities,
  encodeMessage,
  MIN_SUPPORTED_PROTOCOL_VERSION,
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
    /** Omitted stands for a CLI built before capabilities existed. */
    capabilities?: ExecutorCapabilities;
    /** Omitted leaves an `approval.request` unanswered, like an empty chair. */
    answerApproval?: boolean;
  } = {},
) {
  const socket = await dial();

  const seen: Array<{ requestId: string; tool: string; args: unknown }> = [];
  /** Request ids the relay asked us to stop working on. */
  const cancelled: string[] = [];
  /** Questions the relay put to this terminal. */
  const asked: ApprovalRequestMessage[] = [];
  /** Questions the relay said were over, answered elsewhere or expired. */
  const resolved: string[] = [];
  /** Resolves with the relay's answer to `hello`, for the tests that read it. */
  let acknowledge: (ack: { latestCliVersion?: string | undefined }) => void;
  const ack = new Promise<{ latestCliVersion?: string | undefined }>((resolve) => {
    acknowledge = resolve;
  });

  socket.addEventListener("message", (event: MessageEvent) => {
    const message = decodeRelayMessage(String(event.data));

    if (message?.type === "hello.ack") {
      acknowledge(message);
      return;
    }

    if (message?.type === "approval.request") {
      asked.push(message);
      const answer = options.answerApproval;
      if (answer !== undefined) {
        socket.send(encodeMessage({ type: "approval.answer", id: message.id, approved: answer }));
      }
      return;
    }

    if (message?.type === "approval.resolved") {
      resolved.push(message.id);
      return;
    }

    if (message?.type === "cancel") {
      cancelled.push(message.requestId);
      return;
    }

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
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    }),
  );

  return { socket, seen, cancelled, asked, resolved, ack };
}

/** A machine with a terminal someone could be asked at. */
const CAN_PROMPT: ExecutorCapabilities = { prompt: true, tools: [...BASELINE_CAPABILITIES.tools] };

const question = {
  id: "apr_1",
  projectId: "prj_test",
  tool: "run_command" as const,
  prompt: "Run `npm test`?",
};

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

describe("cancellation", () => {
  it("tells the executor to stop and fails the call with CANCELLED", async () => {
    const executor = await attachFakeExecutor({ silent: true });

    const pending = failureOf(() =>
      relay().callTool({
        requestId: "req_cancel",
        projectId: "prj_test",
        tool: "run_command",
        args: { command: "sleep 300" },
      }),
    );
    await vi.waitFor(() => expect(executor.seen).toHaveLength(1));

    await relay().cancelTool("req_cancel");

    expect((await pending).code).toBe("CANCELLED");
    // The half that actually stops the work. Rejecting the caller alone would
    // leave `sleep 300` running on the machine for its full timeout.
    await vi.waitFor(() => expect(executor.cancelled).toEqual(["req_cancel"]));

    executor.socket.close(1000, "done");
  });

  it("still tells the executor when the call is already gone from the map", async () => {
    const executor = await attachFakeExecutor();

    // Answered and settled, so there is no pending entry left to reject. The
    // frame goes out anyway: the relay cannot know whether the executor also
    // considers it finished.
    await relay().callTool({
      requestId: "req_done",
      projectId: "prj_test",
      tool: "read_file",
      args: { path: "a.ts" },
    });

    await relay().cancelTool("req_done");

    await vi.waitFor(() => expect(executor.cancelled).toEqual(["req_done"]));
    executor.socket.close(1000, "done");
  });

  it("does not fail when nothing is connected", async () => {
    await relay().cancelTool("req_nobody");
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
  it("refuses a CLI speaking a version it cannot read, rather than misreading its frames", async () => {
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

  it("still serves the oldest version it claims to support", async () => {
    // The point of the range: an old CLI is behind, not broken. When these two
    // constants are equal this asserts the boundary is inclusive; when they
    // diverge it becomes the test that the floor is real.
    expect(MIN_SUPPORTED_PROTOCOL_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);

    const socket = await dial();
    socket.send(
      encodeMessage({
        type: "hello",
        protocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
        deviceId: "dev_test",
        cliVersion: "0.1.0",
        platform: "linux",
        projects: [],
      }),
    );

    await vi.waitFor(async () => expect(await relay().isOnline()).toBe(true));
    socket.close(1000, "done");
  });
});

describe("approval", () => {
  it("asks the terminal and returns what it said", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: true,
    });

    expect(await relay().requestApproval(question)).toBe("approved");
    expect(executor.asked[0]?.prompt).toBe("Run `npm test`?");
    executor.socket.close(1000, "done");
  });

  it("carries a no back as a decision, not as a failure", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: false,
    });

    expect(await relay().requestApproval(question)).toBe("declined");
    executor.socket.close(1000, "done");
  });

  it("does not ask a machine with nobody at it", async () => {
    // No `capabilities.prompt`: under systemd, or in a detached pane. Sending
    // the question anyway would spend the whole ninety seconds waiting on a
    // terminal nobody is looking at, when the dashboard could answer at once.
    const executor = await attachFakeExecutor({ answerApproval: true });

    const pending = relay().requestApproval(question);
    await vi.waitFor(async () => expect(await relay().listApprovals()).toHaveLength(1));

    expect(executor.asked).toEqual([]);

    // Still answerable, which is the point: this is the headless case.
    expect(await relay().answerApproval(question.id, true)).toBe(true);
    expect(await pending).toBe("approved");
    executor.socket.close(1000, "done");
  });

  it("lets the dashboard answer, and tells the terminal the question is over", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = relay().requestApproval(question);
    await vi.waitFor(() => expect(executor.asked).toHaveLength(1));

    await relay().answerApproval(question.id, true);

    expect(await pending).toBe("approved");
    // Without this the prompt would sit on the terminal, and typing into it
    // would do nothing, which is worse than never having shown it.
    await vi.waitFor(() => expect(executor.resolved).toEqual([question.id]));
    executor.socket.close(1000, "done");
  });

  it("gives the first answer the decision and the second nothing", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: true,
    });

    expect(await relay().requestApproval(question)).toBe("approved");
    // The terminal already settled it. A dashboard click landing now finds
    // nothing, which is what the 409 in the API is built on.
    expect(await relay().answerApproval(question.id, false)).toBe(false);
    executor.socket.close(1000, "done");
  });

  it("lists what is waiting, so the dashboard has something to show", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = relay().requestApproval({ ...question, clientName: "ChatGPT" });
    await vi.waitFor(async () => expect(await relay().listApprovals()).toHaveLength(1));

    const [waiting] = await relay().listApprovals();
    expect(waiting).toMatchObject({
      id: question.id,
      projectId: "prj_test",
      tool: "run_command",
      prompt: "Run `npm test`?",
      clientName: "ChatGPT",
    });

    await relay().answerApproval(question.id, false);
    expect(await pending).toBe("declined");
    executor.socket.close(1000, "done");
  });

  it("refuses to ask when no machine is connected", async () => {
    // Nothing to confirm: the call would fail either way, and the one thing
    // this spends is a person's attention.
    const error = await failureOf(() => relay().requestApproval(question));
    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
  });

  it("ends a question when the machine goes away", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = relay().requestApproval(question);
    await vi.waitFor(() => expect(executor.asked).toHaveLength(1));

    executor.socket.close(1000, "gone");

    // Not left to time out: the call it guards cannot run now regardless, so
    // waiting the full ninety seconds would only delay saying so.
    expect(await pending).toBe("unanswered");
    expect(await relay().listApprovals()).toEqual([]);
  });
});

describe("capabilities", () => {
  it("reports none at all when no executor is connected", async () => {
    // Distinct from the baseline on purpose: an offline machine has nothing to
    // report, which is a different answer from a machine reporting the six.
    expect(await relay().capabilities()).toBeNull();
  });

  it("reads an executor that announced nothing as the six original tools", async () => {
    const executor = await attachFakeExecutor();

    await vi.waitFor(async () =>
      expect(await relay().capabilities()).toEqual(BASELINE_CAPABILITIES),
    );
    executor.socket.close(1000, "done");
  });

  it("reports what a newer executor announced, tools it does not know included", async () => {
    const announced: ExecutorCapabilities = {
      prompt: true,
      tools: ["read_file", "start_command", "a_tool_from_the_future"],
    };
    const executor = await attachFakeExecutor({ capabilities: announced });

    await vi.waitFor(async () => expect(await relay().capabilities()).toEqual(announced));
    executor.socket.close(1000, "done");
  });

  it("tells the executor which CLI version is current", async () => {
    const executor = await attachFakeExecutor();

    expect((await executor.ack).latestCliVersion).toBe(env.LATEST_CLI_VERSION);
    executor.socket.close(1000, "done");
  });
});
