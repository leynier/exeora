import {
  decodeRelayMessage,
  ExeoraError,
  encodeMessage,
  HEARTBEAT_INTERVAL_MS,
  isToolName,
  PROTOCOL_VERSION,
  type WireError,
} from "@exeora/protocol";
import { accessToken } from "./auth/tokens.js";
import { config, findProject, gatewayUrl, projects } from "./config.js";
import { executeTool } from "./tools/index.js";
import { CLI_VERSION } from "./version.js";

/**
 * The executor's outbound connection to the relay.
 *
 * The CLI always dials the gateway. Nothing ever dials the CLI, which is the
 * whole reason no port has to be opened, no tunnel configured and no VPN run.
 *
 * Reconnects with exponential backoff, because a laptop lid closing is normal
 * and should not need a human to type `exeora connect` again.
 */

export interface ConnectionEvents {
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onCall?: (tool: string, projectSlug: string) => void;
  onResult?: (tool: string, ok: boolean, durationMs: number) => void;
  onError?: (message: string) => void;
}

export interface Connection {
  /** Resolves when the connection is stopped for good. */
  closed: Promise<void>;
  stop: () => void;
}

export function connect(deviceId: string, events: ConnectionEvents = {}): Connection {
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retryDelayMs = 1_000;
  let stopped = false;
  let resolveClosed: () => void;

  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const teardown = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    socket = null;
  };

  const scheduleRetry = (reason: string) => {
    teardown();
    if (stopped) {
      resolveClosed();
      return;
    }
    events.onClose?.(`${reason} Reconnecting in ${Math.round(retryDelayMs / 1000)}s.`);
    setTimeout(open, retryDelayMs);
    // Cap at 30s: long enough not to hammer a gateway that is down, short
    // enough that a machine coming back from sleep is usable quickly.
    retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
  };

  async function open(): Promise<void> {
    if (stopped) return;

    let url: URL;
    let token: string;
    try {
      token = await accessToken();
      url = new URL(`/api/relay/${deviceId}`, gatewayUrl());
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    } catch (error) {
      events.onError?.(error instanceof Error ? error.message : "Could not authenticate.");
      scheduleRetry("Authentication failed.");
      return;
    }

    // `headers` is a Node extension to the WHATWG WebSocket API (verified: the
    // Authorization header does reach the server). It matters because the
    // gateway authorises this upgrade with the same bearer token as every other
    // API request. The alternative, smuggling the token through
    // Sec-WebSocket-Protocol, would need a bespoke auth path on the server.
    const next = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
    } as unknown as string[]);
    socket = next;

    next.addEventListener("open", () => {
      retryDelayMs = 1_000;
      next.send(
        encodeMessage({
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          deviceId,
          cliVersion: CLI_VERSION,
          platform: process.platform,
          projects: projects().map((project) => ({ id: project.id, slug: project.slug })),
        }),
      );
      heartbeat = setInterval(() => {
        if (next.readyState === next.OPEN) {
          next.send(encodeMessage({ type: "heartbeat", at: Date.now() }));
        }
      }, HEARTBEAT_INTERVAL_MS);
      events.onOpen?.();
    });

    next.addEventListener("message", (event) => {
      void handleMessage(next, String(event.data), events);
    });

    next.addEventListener("close", (event) => {
      // 1008 is the gateway refusing us: a revoked device or an unsupported
      // protocol. Retrying would loop forever, so stop and say why.
      if (event.code === 1008) {
        stopped = true;
        events.onError?.(event.reason || "The gateway closed the connection.");
        teardown();
        resolveClosed();
        return;
      }
      scheduleRetry("Disconnected.");
    });

    next.addEventListener("error", () => {
      // A failed connection also fires `close`; leave the retry to that.
    });
  }

  void open();

  return {
    closed,
    stop: () => {
      stopped = true;
      if (socket && socket.readyState === socket.OPEN) socket.close(1000, "shutting down");
      else {
        teardown();
        resolveClosed();
      }
    },
  };
}

async function handleMessage(
  socket: WebSocket,
  raw: string,
  events: ConnectionEvents,
): Promise<void> {
  const message = decodeRelayMessage(raw);
  if (!message) return;

  switch (message.type) {
    case "hello.ack":
      return;

    case "shutdown":
      events.onError?.(message.reason);
      return;

    case "cancel":
      // Cancellation is not implemented yet; the call will finish and its
      // result be discarded by the relay.
      return;

    case "tool.call": {
      const startedAt = Date.now();
      const send = (result: { ok: true; value: unknown } | { ok: false; error: WireError }) => {
        if (socket.readyState !== socket.OPEN) return;
        socket.send(
          encodeMessage({
            type: "tool.result",
            requestId: message.requestId,
            durationMs: Date.now() - startedAt,
            result,
          }),
        );
        events.onResult?.(message.tool, result.ok, Date.now() - startedAt);
      };

      // A call that outlived its deadline is dropped rather than run. This is
      // the guard against a command landing long after it was asked for, when
      // a machine reconnects after being away.
      if (Date.now() > message.expiresAt) {
        send({
          ok: false,
          error: { code: "TOOL_TIMEOUT", message: "The request expired before it was received." },
        });
        return;
      }

      const project = findProject(message.projectId);
      if (!project) {
        send({
          ok: false,
          error: {
            code: "UNKNOWN_PROJECT",
            message: "This machine does not serve that project. Run `exeora project add` there.",
          },
        });
        return;
      }

      if (!isToolName(message.tool)) {
        send({ ok: false, error: { code: "UNKNOWN_TOOL", message: "Unsupported tool." } });
        return;
      }

      events.onCall?.(message.tool, project.slug);

      try {
        const value = await executeTool({ root: project.root }, message.tool, message.arguments);
        send({ ok: true, value });
      } catch (error) {
        send({ ok: false, error: toWireError(error) });
      }
      return;
    }
  }
}

function toWireError(error: unknown): WireError {
  if (error instanceof ExeoraError) return { code: error.code, message: error.message };
  return {
    code: "TOOL_FAILED",
    message: error instanceof Error ? error.message : "The tool failed.",
  };
}

export { config };
