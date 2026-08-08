import { HEARTBEAT_TIMEOUT_MS } from "@exeora/protocol";
import type { DeviceView, ToolCallView } from "./api.js";
import { gatewayUrl } from "./config.js";

/**
 * Turning what the gateway said into what a person reads.
 *
 * Nothing here decides anything; every function is a pure rendering of a value
 * the API already answered with. They live together because the tables in
 * `status` and `logs` have to line up with each other.
 */

/**
 * Whether a machine is connected right now.
 *
 * The gateway sends the answer, having recorded both the connection and the
 * disconnection. The `lastSeenAt` fallback is for a self-hosted gateway that
 * predates the field: without it a new CLI would report every machine offline
 * against an older deployment, and there it is the only signal available.
 *
 * The fallback keeps the old window rather than `PRESENCE_TIMEOUT_MS`. That
 * wider window is sized for a checkpoint written every fifteen minutes; a
 * gateway without the `online` field writes `lastSeenAt` on every heartbeat, so
 * reading it through the wide window would call a machine that has been off for
 * twenty minutes online.
 */
export function isOnline(device: DeviceView): boolean {
  if (device.revokedAt !== null) return false;
  if (typeof device.online === "boolean") return device.online;
  return device.lastSeenAt !== null && Date.now() - device.lastSeenAt < HEARTBEAT_TIMEOUT_MS;
}

export function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/**
 * The one URL that covers every project, mentioned wherever a project's own is
 * printed.
 *
 * Built from the configured gateway rather than hard-coded, so it points at
 * localhost during development exactly as the per-project URLs do.
 */
export function accountMcpUrl(): string {
  return new URL("/mcp", gatewayUrl()).toString();
}

/**
 * The AI client behind a call.
 *
 * The registered name is preferred over the raw client id, which is opaque and
 * says nothing to a reader. Calls recorded before a client was ever nameable
 * fall through to "unknown" rather than showing that id.
 */
export function nameOf(call: ToolCallView): string {
  return call.clientName ?? (call.clientId ? "unknown" : "—");
}

export function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
