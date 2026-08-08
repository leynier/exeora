import { env } from "cloudflare:test";
import {
  type ApprovalRequestMessage,
  BASELINE_CAPABILITIES,
  decodeRelayMessage,
  type ExecutorCapabilities,
  encodeMessage,
  PROTOCOL_VERSION,
  type ToolResultMessage,
} from "@exeora/protocol";

/**
 * The world the relay suites run in: one Durable Object, one device id, and a
 * stand-in for the CLI on the other end of the socket.
 *
 * The ids are module state rather than arguments because every helper here
 * needs both and a test never cares what they are. `freshRelay()` is what a
 * suite calls in `beforeEach`, and the reason it must is written below.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite of its own.
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

/** New ids for the next test. Call from `beforeEach`, never inside a test. */
export function freshRelay(): void {
  deviceId = `dev_${crypto.randomUUID()}`;
  relayName = `usr_test:${deviceId}`;
}

/** The device id the current test is working with, for the rows that name it. */
export function currentDeviceId(): string {
  return deviceId;
}

export function relay() {
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
export async function failureOf(call: () => Promise<unknown>): Promise<{ code?: string }> {
  try {
    await call();
  } catch (error) {
    return error as { code?: string };
  }
  throw new Error("expected the call to fail, but it resolved");
}

/** Opens the executor socket the way the Worker does: over fetch, not RPC. */
export async function dial() {
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

export async function dialCaller(kind: "tool" | "approval", id: string) {
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
export async function attachFakeExecutor(
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
export const CAN_PROMPT: ExecutorCapabilities = {
  prompt: true,
  tools: [...BASELINE_CAPABILITIES.tools],
};

export const question = {
  id: "apr_1",
  projectId: "prj_test",
  tool: "run_command" as const,
  prompt: "Run `npm test`?",
};
