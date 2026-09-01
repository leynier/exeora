import { env } from "cloudflare:test";
import {
  BASELINE_CAPABILITIES,
  type ExecutorCapabilities,
  encodeMessage,
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  RELAY_TIMEOUT_MS,
  type ToolResultMessage,
} from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db/client.js";
import { callRelayTool } from "./relay-client.js";
import {
  attachFakeExecutor,
  currentDeviceId,
  dial,
  dialCaller,
  eventually,
  failureOf,
  freshRelay,
  relay,
} from "./relay-do-fixtures.js";

/**
 * The relay under workerd, so hibernation, WebSocketPair and D1 behave as they
 * will in production.
 */

beforeEach(freshRelay);

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
        id: currentDeviceId(),
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
      .where(eq(schema.devices.id, currentDeviceId()))
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

    await eventually(async () => expect((await deviceRow()).disconnectedAt).not.toBeNull());
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
    await eventually(async () =>
      expect((await deviceRow()).lastSeenAt?.getTime()).toBeGreaterThan(LONG_AGO.getTime()),
    );
    expect((await deviceRow()).disconnectedAt).toBeNull();

    second.close(1000, "done");
    await eventually(async () => expect((await deviceRow()).disconnectedAt).not.toBeNull());
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

    await eventually(() => expect(executor.seen).toHaveLength(1));
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
    await eventually(() => expect(executor.seen).toHaveLength(1));

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
    await eventually(() => expect(executor.seen).toHaveLength(1));

    controller.abort();

    expect((await pending).code).toBe("CANCELLED");
    // The half that actually stops the work. Rejecting the caller alone would
    // leave `sleep 300` running on the machine for its full timeout.
    await eventually(() => expect(executor.cancelled).toEqual(["req_cancel"]));

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
        deviceId: currentDeviceId(),
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
        deviceId: currentDeviceId(),
        cliVersion: "0.1.0",
        platform: "linux",
        projects: [],
      }),
    );

    await eventually(async () => expect(await relay().isOnline()).toBe(true));
    socket.close(1000, "done");
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

    await eventually(async () =>
      expect(await relay().capabilities()).toEqual(BASELINE_CAPABILITIES),
    );
    executor.socket.close(1000, "done");
  });

  it("never sends a worktree call to an executor that did not negotiate routing", async () => {
    const executor = await attachFakeExecutor();
    const error = await failureOf(() =>
      callRelayTool(relay(), {
        requestId: "req_old_cli_worktree",
        projectId: "prj_test",
        worktreeId: "wtr_feature",
        worktreeSlug: "feature",
        tool: "read_file",
        args: { path: "README.md" },
      }),
    );

    expect(error.code).toBe("WORKTREE_UNAVAILABLE");
    expect(executor.seen).toEqual([]);
    executor.socket.close(1000, "done");
  });

  it("reports what a newer executor announced, tools it does not know included", async () => {
    const announced: ExecutorCapabilities = {
      prompt: true,
      tools: ["read_file", "start_command", "a_tool_from_the_future"],
      worktreeRouting: true,
    };
    const executor = await attachFakeExecutor({ capabilities: announced });

    await eventually(async () => expect(await relay().capabilities()).toEqual(announced));
    executor.socket.close(1000, "done");
  });

  it("tells the executor which CLI version is current", async () => {
    const executor = await attachFakeExecutor();

    expect((await executor.ack).latestCliVersion).toBe(env.LATEST_CLI_VERSION);
    executor.socket.close(1000, "done");
  });
});
