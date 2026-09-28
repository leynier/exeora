import {
  CLOUD_FEATURE,
  CLOUD_HOOKS_FEATURE,
  type CloudHook,
  encodeMessage,
  HEARTBEAT_INTERVAL_MS,
  type HelloMessage,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from "@exeora/protocol";
import { hooksConfigFor } from "./cloud/hooks.js";
import "./env.js";
import { touchDevice } from "./presence.js";
import {
  attachmentOf,
  type ExecutorSocketState,
  executorSocket,
  replaceOtherExecutors,
} from "./relay-do-callers.js";
import type { CloudWakeState } from "./relay-do-cloud.js";
import { resetExecutorTerminals } from "./relay-do-terminal.js";
import { clearMcpCatalogs } from "./relay-mcp.js";

/**
 * What the relay does when a CLI introduces itself, and what it tells an
 * instance of Exeora Cloud about its project's scripts.
 *
 * Beside `relay-do.ts` rather than inside it only because that file is at its
 * length limit. Nothing here holds state of its own: it is handed the
 * object's.
 */

interface Relay {
  ctx: DurableObjectState;
  env: Env;
  cloud: CloudWakeState;
}

export async function handleHello(
  relay: Relay,
  socket: WebSocket,
  state: ExecutorSocketState,
  message: HelloMessage,
): Promise<void> {
  // A range, not an equality. Anything a newer CLI gained is negotiated
  // through `capabilities`, so an older one is behind rather than broken,
  // and only a change it would get actively wrong raises the floor.
  const supported =
    message.protocolVersion >= MIN_SUPPORTED_PROTOCOL_VERSION &&
    message.protocolVersion <= PROTOCOL_VERSION;

  if (!supported) {
    const direction =
      message.protocolVersion > PROTOCOL_VERSION
        ? "This CLI is newer than the gateway. It will work again once the gateway catches up."
        : "Update the CLI.";

    socket.send(
      encodeMessage({
        type: "shutdown",
        reason:
          `This gateway speaks protocol v${MIN_SUPPORTED_PROTOCOL_VERSION} to v${PROTOCOL_VERSION}; ` +
          `the CLI speaks v${message.protocolVersion}. ${direction}`,
      }),
    );
    socket.close(1008, "protocol version mismatch");
    return;
  }

  // The id from the upgrade URL, which the Worker checked belongs to the
  // caller, in preference to the one in the frame. `devices` is keyed by
  // id alone, so trusting the frame would let any account refresh the
  // presence and CLI version of a machine it does not own.
  const deviceId = state.deviceId || message.deviceId;
  const features = message.capabilities?.features ?? [];

  replaceOtherExecutors(relay.ctx, socket);
  await clearMcpCatalogs(relay.ctx);
  socket.serializeAttachment({
    role: "executor",
    deviceId,
    active: true,
    ...(message.capabilities ? { capabilities: message.capabilities } : {}),
  } satisfies ExecutorSocketState);
  relay.cloud.holdsTasks = features.includes(CLOUD_FEATURE);
  await resetExecutorTerminals(relay.ctx);

  // Only a CLI that runs the scripts is told them. An instance says hello
  // every time it resumes, so this is also how an edit made on the project's
  // page reaches an instance that was made before it.
  const cloudHooks = features.includes(CLOUD_HOOKS_FEATURE)
    ? await hooksConfigFor(relay.env, deviceId)
    : undefined;

  socket.send(
    encodeMessage({
      type: "hello.ack",
      serverTime: Date.now(),
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      heartbeatMode: "auto",
      ...(relay.env.LATEST_CLI_VERSION ? { latestCliVersion: relay.env.LATEST_CLI_VERSION } : {}),
      ...(cloudHooks ? { cloudHooks } : {}),
    }),
  );
  await touchDevice(relay.env, deviceId, {
    cliVersion: message.cliVersion,
    force: true,
    connected: true,
  });
}

export type HookRequest = "sent" | "unsupported" | "offline";

/**
 * Asks the connected instance to run one of its scripts again, with the
 * scripts as they are now rather than as they were when it last said hello.
 */
export async function requestHookRun(relay: Relay, hook: CloudHook): Promise<HookRequest> {
  const socket = executorSocket(relay.ctx);
  if (!socket) return "offline";
  const state = attachmentOf(socket);
  if (state?.role !== "executor") return "offline";
  if (!state.capabilities?.features?.includes(CLOUD_HOOKS_FEATURE)) return "unsupported";
  const config = await hooksConfigFor(relay.env, state.deviceId);
  if (!config) return "unsupported";
  try {
    socket.send(encodeMessage({ type: "cloud.hook.run", hook, config }));
    return "sent";
  } catch {
    return "offline";
  }
}
