import {
  decodeRelayMessage,
  type ExecutorCapabilities,
  ExeoraError,
  encodeMessage,
  HEARTBEAT_INTERVAL_MS,
  isToolName,
  PROTOCOL_VERSION,
  policyAllows,
  TOOL_NAMES,
  type ToolCallMessage,
  type WireError,
} from "@exeora/protocol";
import { accessToken } from "./auth/tokens.js";
import { config, findProject, gatewayUrl, projects } from "./config.js";
import { effectivePolicy } from "./policy.js";
import { executeTool } from "./tools/index.js";
import { killAllProcesses } from "./tools/processes.js";
import { CLI_VERSION, isOutdated } from "./version.js";

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
  /** `client` is the AI client that asked, when the gateway could name one. */
  onCall?: (tool: string, projectSlug: string, client?: string) => void;
  onResult?: (tool: string, ok: boolean, durationMs: number) => void;
  onError?: (message: string) => void;
  /** Worth saying, but nothing is wrong: a newer CLI exists, for instance. */
  onNotice?: (message: string) => void;
  /**
   * Asks the person at this terminal whether a call may run.
   *
   * Lives here as an event rather than as a prompt in this file because drawing
   * on a terminal belongs to the command, not to the socket. `signal` aborts
   * when the question is answered elsewhere or expires, so the prompt comes down
   * instead of waiting for an answer that would be ignored.
   *
   * Only ever called when this CLI announced `prompt` at connect time, so an
   * implementation may assume there is a terminal.
   */
  onApproval?: (ask: {
    prompt: string;
    tool: string;
    projectSlug: string;
    client?: string | undefined;
    signal: AbortSignal;
  }) => Promise<boolean>;
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

  /**
   * Calls currently running, so `cancel` has something to act on.
   *
   * Keyed by request id and cleared as each call answers. It lives out here
   * rather than inside `handleMessage` because the cancellation arrives as a
   * separate frame, in a separate invocation, from the call it refers to.
   */
  const inFlight = new Map<string, AbortController>();

  /**
   * Questions currently on screen, so `approval.resolved` can take one down.
   *
   * Separate from `inFlight` because an approval is not a call: nothing is
   * running yet, and the two are answered on different rounds.
   */
  const asking = new Map<string, AbortController>();

  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const teardown = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    socket = null;

    // The relay already failed every pending call the moment the socket closed,
    // so there is nobody left to hand a result to. Letting the commands run on
    // would be the "it landed anyway" hazard, one reconnect later.
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();

    // And nobody left to hear the answer to a question either. Leaving a prompt
    // up would invite someone to approve a call that can no longer run.
    for (const controller of asking.values()) controller.abort();
    asking.clear();

    // Long-running processes go too. This is the line that makes "they die with
    // the connection" true: a dev server nobody can reach, read or stop is not
    // a feature, and a laptop waking up with four of them is the hazard.
    killAllProcesses();
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
          capabilities: capabilities(events),
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
      void handleMessage(next, String(event.data), events, { inFlight, asking });
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

interface Live {
  /** Tool calls running now, so `cancel` has something to act on. */
  inFlight: Map<string, AbortController>;
  /** Questions on screen, so `approval.resolved` can take one down. */
  asking: Map<string, AbortController>;
}

async function handleMessage(
  socket: WebSocket,
  raw: string,
  events: ConnectionEvents,
  live: Live,
): Promise<void> {
  const message = decodeRelayMessage(raw);
  if (!message) return;

  const { inFlight, asking } = live;

  switch (message.type) {
    case "hello.ack": {
      // Said once per connection rather than once per reconnect storm would be
      // better, but a reconnect only re-prints this when the gateway is up,
      // which is exactly when it is worth reading.
      if (message.latestCliVersion && isOutdated(CLI_VERSION, message.latestCliVersion)) {
        events.onNotice?.(
          `A newer Exeora CLI is available (${CLI_VERSION} → ${message.latestCliVersion}). ` +
            "Update with `npm i -g @exeora/cli`.",
        );
      }
      return;
    }

    case "shutdown":
      events.onError?.(message.reason);
      return;

    case "cancel": {
      // Unknown ids are normal rather than an error: the relay cancels on its
      // own deadline too, and by then the call has often already answered.
      inFlight.get(message.requestId)?.abort();
      return;
    }

    case "approval.resolved": {
      // Answered in the dashboard, or nobody answered in time. Either way the
      // prompt here is now about a decision already made.
      asking.get(message.id)?.abort();
      asking.delete(message.id);
      return;
    }

    case "approval.request": {
      // The relay only sends these to a CLI that announced it can ask, so no
      // handler is a bug rather than a configuration. Answering no is the safe
      // reading of "there is nobody here".
      if (!events.onApproval) {
        socket.send(encodeMessage({ type: "approval.answer", id: message.id, approved: false }));
        return;
      }

      const controller = new AbortController();
      asking.set(message.id, controller);

      try {
        const approved = await events.onApproval({
          prompt: message.prompt,
          tool: message.tool,
          projectSlug: findProject(message.projectId)?.slug ?? message.projectId,
          client: describeClient(message.client),
          signal: controller.signal,
        });

        // Aborted means the question was settled elsewhere. Sending an answer
        // now would be a second one, which the relay drops, but sending it at
        // all would suggest this terminal decided something it did not.
        if (!controller.signal.aborted && socket.readyState === socket.OPEN) {
          socket.send(encodeMessage({ type: "approval.answer", id: message.id, approved }));
        }
      } catch {
        // A prompt that could not be shown is not a yes.
        if (!controller.signal.aborted && socket.readyState === socket.OPEN) {
          socket.send(encodeMessage({ type: "approval.answer", id: message.id, approved: false }));
        }
      } finally {
        asking.delete(message.id);
      }
      return;
    }

    case "tool.call": {
      const startedAt = Date.now();
      const send = (result: { ok: true; value: unknown } | { ok: false; error: WireError }) => {
        inFlight.delete(message.requestId);
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

      events.onCall?.(message.tool, project.slug, describeClient(message.client));

      // The account's policy, narrowed by the project's own exeora.toml. The
      // gateway has already applied its half; this is the half that knows about
      // the file, and the one that still stands if the gateway is wrong.
      const { policy, problem } = await effectivePolicy(project.root, message.policy);
      if (problem) events.onError?.(problem);

      const verdict = policyAllows(policy, message.tool, message.arguments);
      if (!verdict.allowed) {
        send({
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: verdict.reason ?? "This project does not allow that.",
          },
        });
        return;
      }

      const controller = new AbortController();
      inFlight.set(message.requestId, controller);

      try {
        const value = await executeTool(
          { root: project.root, signal: controller.signal },
          message.tool,
          message.arguments,
        );
        send({ ok: true, value });
      } catch (error) {
        send({ ok: false, error: toWireError(error) });
      }
      return;
    }
  }
}

/**
 * The AI client as one readable string, or nothing.
 *
 * A gateway that predates this field, or a client that registered no name and
 * announces nothing over MCP, both land on undefined; the line is printed
 * without it rather than with a placeholder.
 */
function describeClient(client: ToolCallMessage["client"]): string | undefined {
  if (!client?.name) return client?.version;
  return client.version ? `${client.name} ${client.version}` : client.name;
}

/**
 * What this executor can do, announced once at `hello`.
 *
 * `prompt` needs both halves to be true, and claiming it wrongly is the
 * expensive mistake: the gateway would send a question here and wait ninety
 * seconds for an answer that was never going to come, when the dashboard could
 * have handled it at once.
 *
 *  - A handler, because `exeora connect --json` deliberately has none: its
 *    stdout is an event stream being read by a program, not a person.
 *  - A terminal at both ends of the pipe, since the question is drawn on stdout
 *    and the answer typed into stdin. Under systemd, in a detached tmux pane,
 *    or with either stream redirected, there is nobody to ask.
 */
function capabilities(events: ConnectionEvents): ExecutorCapabilities {
  const canAsk =
    events.onApproval !== undefined &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true;

  return { prompt: canAsk, tools: [...TOOL_NAMES] };
}

function toWireError(error: unknown): WireError {
  if (error instanceof ExeoraError) return { code: error.code, message: error.message };
  return {
    code: "TOOL_FAILED",
    message: error instanceof Error ? error.message : "The tool failed.",
  };
}

export { config };
