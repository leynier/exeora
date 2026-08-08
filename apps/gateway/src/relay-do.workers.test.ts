import { env } from "cloudflare:test";
import {
  type ApprovalRequestMessage,
  BASELINE_CAPABILITIES,
  decodeRelayMessage,
  type ExecutorCapabilities,
  encodeMessage,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  MAX_APPROVAL_PROMPT_LENGTH,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  RELAY_TIMEOUT_MS,
  type ToolResultMessage,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "./db/client.js";
import { callRelayTool, requestRelayApproval } from "./relay-client.js";

/**
 * The relay under workerd, so hibernation, WebSocketPair and D1 behave as they
 * will in production.
 */

/**
 * A fresh Durable Object per test. Reusing one leaks sockets between tests:
 * a socket closed in `beforeEach` is still listed by getWebSockets() for a
 * moment, so the next test starts "online" and sends into a dead socket.
 *
 * The device id is fresh for the same reason, one step further out: presence
 * writes go to a `devices` row keyed by that id, and a close handler from the
 * previous test can still be in flight when this one reads the row.
 */
let relayName: string;
let deviceId: string;

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
    new Request(`https://relay/connect?deviceId=${deviceId}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  return socket;
}

async function dialCaller(kind: "tool" | "approval", id: string) {
  const response = await relay().fetch(
    new Request(`https://relay/caller/${kind}?id=${id}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a caller socket");
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
      deviceId,
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
  deviceId = `dev_${crypto.randomUUID()}`;
  relayName = `usr_test:${deviceId}`;
});

describe("presence", () => {
  it("reports offline with no executor attached", async () => {
    expect(await relay().isOnline()).toBe(false);
  });

  it("reports online once the executor dials in", async () => {
    await attachFakeExecutor();
    expect(await relay().isOnline()).toBe(true);
  });

  it("does not mistake a waiting caller for an online executor", async () => {
    const caller = await dialCaller("tool", "req_waiting");

    expect(await relay().isOnline()).toBe(false);

    caller.close(1000, "done");
  });

  it("answers fixed heartbeats without application message handling", async () => {
    const executor = await attachFakeExecutor();
    const response = new Promise<string>((resolve) => {
      executor.socket.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (String(event.data) === HEARTBEAT_RESPONSE) resolve(String(event.data));
        },
        { once: true },
      );
    });

    executor.socket.send(HEARTBEAT_REQUEST);

    expect(await response).toBe(HEARTBEAT_RESPONSE);
  });
});

/**
 * The D1 side of presence, which is what every aggregate view reads.
 *
 * `last_seen_at` is a checkpoint written at most once every fifteen minutes, so
 * the window that reads it is wider still and cannot notice a machine leaving.
 * `disconnected_at` is the part that can, and these are the three moments that
 * decide whether it says the truth.
 */
describe("presence checkpoint", () => {
  const LONG_AGO = new Date(Date.now() - 60 * 60_000);

  async function seedDevice(fields: { lastSeenAt?: Date; disconnectedAt?: Date } = {}) {
    const database = db(env);
    await database
      .insert(schema.users)
      .values({ id: "usr_test", email: "presence@example.com" })
      .onConflictDoNothing()
      .run();
    await database
      .insert(schema.devices)
      .values({
        id: deviceId,
        userId: "usr_test",
        name: "laptop",
        platform: "linux",
        lastSeenAt: fields.lastSeenAt ?? null,
        disconnectedAt: fields.disconnectedAt ?? null,
      })
      .run();
  }

  async function deviceRow() {
    const row = await db(env)
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.id, deviceId))
      .get();
    if (!row) throw new Error("the seeded device is gone");
    return row;
  }

  it("clears a stale disconnection when the CLI says hello", async () => {
    await seedDevice({ lastSeenAt: LONG_AGO, disconnectedAt: LONG_AGO });

    const executor = await attachFakeExecutor();
    await executor.ack;

    const row = await deviceRow();
    expect(row.disconnectedAt).toBeNull();
    expect(row.cliVersion).toBe("0.1.0");
    expect(row.lastSeenAt?.getTime()).toBeGreaterThan(LONG_AGO.getTime());

    executor.socket.close(1000, "done");
  });

  it("records the disconnection at once, rather than waiting out the window", async () => {
    await seedDevice({ lastSeenAt: LONG_AGO });
    const executor = await attachFakeExecutor();
    await executor.ack;

    executor.socket.close(1000, "done");

    await vi.waitFor(async () => expect((await deviceRow()).disconnectedAt).not.toBeNull());
  });

  it("leaves a reconnected machine alone when the old socket's close lands late", async () => {
    // A machine that dropped and redialled faster than the first connection was
    // noticed. Recording the late close would mark it offline while it is
    // sitting there connected, and nothing would correct that for 25 minutes.
    await seedDevice({ lastSeenAt: LONG_AGO });
    const first = await dial();
    const second = await dial();

    first.close(1000, "dropped");

    // The close forces a `last_seen_at` write either way, so waiting on that is
    // waiting for the handler to have run, not for a timeout to expire.
    await vi.waitFor(async () =>
      expect((await deviceRow()).lastSeenAt?.getTime()).toBeGreaterThan(LONG_AGO.getTime()),
    );
    expect((await deviceRow()).disconnectedAt).toBeNull();

    second.close(1000, "done");
    await vi.waitFor(async () => expect((await deviceRow()).disconnectedAt).not.toBeNull());
  });
});

describe("callTool", () => {
  it("fails immediately when no executor is connected, rather than queueing", async () => {
    const error = await failureOf(() =>
      callRelayTool(relay(), {
        requestId: "req_1",
        projectId: "prj_test",
        tool: "read_file",
        args: {},
      }),
    );
    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
  });

  it("forwards the call and returns the executor's value", async () => {
    const executor = await attachFakeExecutor();

    const value = await callRelayTool(relay(), {
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
      callRelayTool(relay(), {
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
        callRelayTool(relay(), {
          requestId: id,
          projectId: "prj_test",
          tool: "grep",
          args: {},
        }),
      ),
    );

    expect(results).toEqual(["a", "b", "c"]);
  });

  it("sends a deadline the executor can use to drop a stale call", async () => {
    const executor = await attachFakeExecutor({ silent: true });
    // Never answered, so it rejects at the deadline long after this test ends.
    // Caught so the rejection is not reported as unhandled.
    void failureOf(() =>
      callRelayTool(relay(), {
        requestId: "req_4",
        projectId: "prj_test",
        tool: "read_file",
        args: {},
      }),
    );

    await vi.waitFor(() => expect(executor.seen).toHaveLength(1));
    executor.socket.close(1000, "done");
  });

  /**
   * An answer that lands on the wrong side of the deadline.
   *
   * `RELAY_TIMEOUT_MS` is minutes long, so the way to reach this is to move the
   * clock rather than to wait. The skew is applied while the executor's frame is
   * on its way back, which is exactly the race: the work is done, the result is
   * in flight, and the deadline passes before the caller reads it.
   */
  describe("an answer that arrives past the deadline", () => {
    const realNow = Date.now;
    let skew = 0;

    beforeEach(() => {
      skew = 0;
      Date.now = () => realNow() + skew;
      return () => {
        Date.now = realNow;
      };
    });

    /** Answers, having let the deadline pass first. */
    function lateExecutor(result: ToolResultMessage["result"]) {
      return attachFakeExecutor({
        respond: () => {
          skew = RELAY_TIMEOUT_MS + 1_000;
          return result;
        },
      });
    }

    it("returns the value rather than reporting a timeout", async () => {
      await lateExecutor({ ok: true, value: { late: true } });

      const value = await callRelayTool(relay(), {
        requestId: "req_late_ok",
        projectId: "prj_test",
        tool: "read_file",
        args: {},
      });

      expect(value).toEqual({ late: true });
    });

    it("keeps the executor's own error code rather than replacing it", async () => {
      // The sharper symptom: the caller is told the call timed out when what
      // actually happened is that the path was refused.
      const executor = await lateExecutor({
        ok: false,
        error: { code: "PATH_ESCAPE", message: "outside the project root" },
      });

      const error = await failureOf(() =>
        callRelayTool(relay(), {
          requestId: "req_late_error",
          projectId: "prj_test",
          tool: "read_file",
          args: { path: "../../etc/passwd" },
        }),
      );

      expect(error.code).toBe("PATH_ESCAPE");
      executor.socket.close(1000, "done");
    });
  });
});

describe("disconnection", () => {
  it("fails an in-flight call when the executor drops", async () => {
    const executor = await attachFakeExecutor({ silent: true });

    const pending = failureOf(() =>
      callRelayTool(relay(), {
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
    const controller = new AbortController();

    const pending = failureOf(() =>
      callRelayTool(relay(), {
        requestId: "req_cancel",
        projectId: "prj_test",
        tool: "run_command",
        args: { command: "sleep 300" },
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(executor.seen).toHaveLength(1));

    controller.abort();

    expect((await pending).code).toBe("CANCELLED");
    // The half that actually stops the work. Rejecting the caller alone would
    // leave `sleep 300` running on the machine for its full timeout.
    await vi.waitFor(() => expect(executor.cancelled).toEqual(["req_cancel"]));

    executor.socket.close(1000, "done");
  });

  it("does not forward a call that was already aborted", async () => {
    const executor = await attachFakeExecutor();
    const controller = new AbortController();
    controller.abort();

    const error = await failureOf(() =>
      callRelayTool(relay(), {
        requestId: "req_aborted",
        projectId: "prj_test",
        tool: "read_file",
        args: {},
        signal: controller.signal,
      }),
    );

    expect(error.code).toBe("CANCELLED");
    expect(executor.seen).toEqual([]);
    executor.socket.close(1000, "done");
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
        deviceId,
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
        deviceId,
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
  it("refuses a prompt that cannot be shown in full", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const error = await failureOf(() =>
      requestRelayApproval(relay(), {
        ...question,
        prompt: "x".repeat(MAX_APPROVAL_PROMPT_LENGTH + 1),
      }),
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(executor.asked).toEqual([]);
    executor.socket.close(1000, "done");
  });

  it("asks the terminal and returns what it said", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: true,
    });

    expect(await requestRelayApproval(relay(), question)).toBe("approved");
    expect(executor.asked[0]?.prompt).toBe("Run `npm test`?");
    executor.socket.close(1000, "done");
  });

  it("carries a no back as a decision, not as a failure", async () => {
    const executor = await attachFakeExecutor({
      capabilities: CAN_PROMPT,
      answerApproval: false,
    });

    expect(await requestRelayApproval(relay(), question)).toBe("declined");
    executor.socket.close(1000, "done");
  });

  it("does not ask a machine with nobody at it", async () => {
    // No `capabilities.prompt`: under systemd, or in a detached pane. Sending
    // the question anyway would spend the whole ninety seconds waiting on a
    // terminal nobody is looking at, when the dashboard could answer at once.
    const executor = await attachFakeExecutor({ answerApproval: true });

    const pending = requestRelayApproval(relay(), question);
    await vi.waitFor(async () => expect(await relay().listApprovals()).toHaveLength(1));

    expect(executor.asked).toEqual([]);

    // Still answerable, which is the point: this is the headless case.
    expect(await relay().answerApproval(question.id, true)).toBe(true);
    expect(await pending).toBe("approved");
    executor.socket.close(1000, "done");
  });

  it("lets the dashboard answer, and tells the terminal the question is over", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = requestRelayApproval(relay(), question);
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

    expect(await requestRelayApproval(relay(), question)).toBe("approved");
    // The terminal already settled it. A dashboard click landing now finds
    // nothing, which is what the 409 in the API is built on.
    expect(await relay().answerApproval(question.id, false)).toBe(false);
    executor.socket.close(1000, "done");
  });

  it("lists what is waiting, so the dashboard has something to show", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = requestRelayApproval(relay(), { ...question, clientName: "ChatGPT" });
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
    const error = await failureOf(() => requestRelayApproval(relay(), question));
    expect(error.code).toBe("LOCAL_EXECUTOR_OFFLINE");
  });

  it("ends a question when the machine goes away", async () => {
    const executor = await attachFakeExecutor({ capabilities: CAN_PROMPT });

    const pending = requestRelayApproval(relay(), question);
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
