import { z } from "zod";
import { ERROR_CODES } from "./errors.js";
import { TOOL_NAMES } from "./tools.js";

/**
 * Wire protocol for the WebSocket the CLI opens *outbound* to the relay
 * Durable Object. The CLI is always the one that dials; the relay never
 * connects to the user's machine.
 *
 * Bump PROTOCOL_VERSION on any breaking change. The relay rejects a `hello`
 * carrying a version it does not understand, so an outdated CLI fails loudly at
 * connect time instead of mid tool call.
 */
export const PROTOCOL_VERSION = 1;

const errorShape = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

export type WireError = z.infer<typeof errorShape>;

// ---------------------------------------------------------------------------
// CLI → relay
// ---------------------------------------------------------------------------

/** First frame after the socket opens. The relay answers with `hello.ack`. */
export const HelloMessage = z.object({
  type: z.literal("hello"),
  protocolVersion: z.number().int(),
  deviceId: z.string(),
  cliVersion: z.string(),
  platform: z.string(),
  /** Projects this executor can currently serve, so the relay can fail fast. */
  projects: z.array(z.object({ id: z.string(), slug: z.string() })),
});

export const HeartbeatMessage = z.object({
  type: z.literal("heartbeat"),
  at: z.number().int(),
});

export const ToolResultMessage = z.object({
  type: z.literal("tool.result"),
  requestId: z.string(),
  durationMs: z.number().int(),
  result: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({ ok: z.literal(false), error: errorShape }),
  ]),
});

export const ExecutorMessage = z.discriminatedUnion("type", [
  HelloMessage,
  HeartbeatMessage,
  ToolResultMessage,
]);

export type HelloMessage = z.infer<typeof HelloMessage>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessage>;
export type ToolResultMessage = z.infer<typeof ToolResultMessage>;
export type ExecutorMessage = z.infer<typeof ExecutorMessage>;

// ---------------------------------------------------------------------------
// Relay → CLI
// ---------------------------------------------------------------------------

export const HelloAckMessage = z.object({
  type: z.literal("hello.ack"),
  serverTime: z.number().int(),
  heartbeatIntervalMs: z.number().int(),
});

export const ToolCallMessage = z.object({
  type: z.literal("tool.call"),
  requestId: z.string(),
  projectId: z.string(),
  tool: z.enum(TOOL_NAMES),
  arguments: z.unknown(),
  issuedAt: z.number().int(),
  /**
   * Absolute deadline. The executor must not start work after this instant —
   * a stale call arriving after a reconnect is exactly the "command runs hours
   * later" hazard we refuse to accept.
   */
  expiresAt: z.number().int(),
});

export const CancelMessage = z.object({
  type: z.literal("cancel"),
  requestId: z.string(),
});

/** Sent when the device is revoked or the protocol version is rejected. */
export const ShutdownMessage = z.object({
  type: z.literal("shutdown"),
  reason: z.string(),
});

export const RelayMessage = z.discriminatedUnion("type", [
  HelloAckMessage,
  ToolCallMessage,
  CancelMessage,
  ShutdownMessage,
]);

export type HelloAckMessage = z.infer<typeof HelloAckMessage>;
export type ToolCallMessage = z.infer<typeof ToolCallMessage>;
export type CancelMessage = z.infer<typeof CancelMessage>;
export type ShutdownMessage = z.infer<typeof ShutdownMessage>;
export type RelayMessage = z.infer<typeof RelayMessage>;

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

export function encodeMessage(message: ExecutorMessage | RelayMessage): string {
  return JSON.stringify(message);
}

/**
 * Parse a frame from the other side. Returns null on anything malformed rather
 * than throwing, so a bad frame drops the message instead of the connection.
 */
export function decodeExecutorMessage(raw: string): ExecutorMessage | null {
  return safeParseJson(raw, ExecutorMessage);
}

export function decodeRelayMessage(raw: string): RelayMessage | null {
  return safeParseJson(raw, RelayMessage);
}

function safeParseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
