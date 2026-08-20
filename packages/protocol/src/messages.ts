import { z } from "zod";
import { ERROR_CODES } from "./errors.js";
import { CommandPolicy } from "./policy.js";
import { TOOL_NAMES } from "./tools.js";
import {
  TerminalCloseMessage,
  TerminalErrorMessage,
  TerminalExitMessage,
  TerminalInputMessage,
  TerminalOpenedMessage,
  TerminalOpenMessage,
  TerminalOutputMessage,
  TerminalResizeMessage,
  WorkspaceAction,
  WorkspaceValue,
} from "./workspace.js";

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

/**
 * The oldest version the relay still serves.
 *
 * A range rather than an equality, because the alternative is that every
 * addition to this protocol disconnects every CLI in the world at the moment
 * the gateway deploys. Anything a newer CLI gained is negotiated through
 * `capabilities` below instead, which is a question the gateway can ask and an
 * older CLI answers by omission.
 *
 * Raise this only for a change an old CLI would get *wrong*, as opposed to one
 * it would merely not have. That is what the version is for, and it is why it
 * should move rarely.
 */
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

/**
 * What this executor can do beyond the baseline every version can.
 *
 * Absent means an executor built before this field existed: the six original
 * tools, and no way to ask a person anything. Read that way rather than
 * refused, which is the whole point.
 */
export const ExecutorCapabilities = z.object({
  /**
   * Whether there is a terminal here that a person could be asked at.
   *
   * False under systemd, in a detached tmux pane, or anywhere stdin is not a
   * TTY. The gateway uses it to decide whether asking on the machine is worth
   * trying at all, rather than sending a question into a void and waiting.
   */
  prompt: z.boolean(),
  /**
   * Tool names this executor can run.
   *
   * Deliberately `string` and not the tool enum: a CLI newer than the gateway
   * may name tools this build has never heard of, and dropping the whole frame
   * over that would reintroduce exactly the brittleness the version range
   * removes. Unknown names are ignored by whoever reads this.
   */
  tools: z.array(z.string().max(64)).max(64),
  /** Additive non-MCP surfaces this executor understands. */
  features: z.array(z.string().max(64)).max(32).optional(),
  /** Whether tool calls can target a registered Git worktree by stable id. */
  worktreeRouting: z.boolean().optional(),
});

export type ExecutorCapabilities = z.infer<typeof ExecutorCapabilities>;

/**
 * What an executor that announced nothing is taken to do.
 *
 * The list is written out rather than derived from `TOOL_NAMES`, and that is
 * the entire point of it: `TOOL_NAMES` grows, and a baseline that grew with it
 * would claim that every CLI ever published supports whatever was added last
 * week. These six are what shipped before capabilities existed, so this list is
 * history and must never be edited to add a tool.
 */
export const BASELINE_CAPABILITIES: ExecutorCapabilities = {
  prompt: false,
  tools: ["read_file", "list_files", "grep", "edit_file", "write_file", "run_command"],
};

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
  /** Optional so a CLI predating the field still produces a valid `hello`. */
  capabilities: ExecutorCapabilities.optional(),
});

/**
 * Fixed heartbeat frames can be answered by `setWebSocketAutoResponse`
 * without waking the Durable Object. Keep these byte-for-byte stable.
 */
export const HEARTBEAT_REQUEST = '{"type":"heartbeat"}';
export const HEARTBEAT_RESPONSE = '{"type":"heartbeat.ack"}';

export const HeartbeatMessage = z.object({
  type: z.literal("heartbeat"),
  /** Accepted for CLIs predating the fixed auto-response frame. */
  at: z.number().int().optional(),
});

/** Slow, persisted presence checkpoint; connectivity does not depend on it. */
export const PresenceMessage = z.object({
  type: z.literal("presence"),
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

export const WorkspaceResultMessage = z.object({
  type: z.literal("workspace.result"),
  requestId: z.string(),
  durationMs: z.number().int(),
  result: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: WorkspaceValue }),
    z.object({ ok: z.literal(false), error: errorShape }),
  ]),
});

/**
 * The person at this machine answering an `approval.request`.
 *
 * A separate round from the tool call it belongs to, because the call has not
 * been sent yet: nothing runs until this comes back true.
 */
export const ApprovalAnswerMessage = z.object({
  type: z.literal("approval.answer"),
  id: z.string(),
  approved: z.boolean(),
});

export const ExecutorMessage = z.discriminatedUnion("type", [
  HelloMessage,
  HeartbeatMessage,
  PresenceMessage,
  ToolResultMessage,
  WorkspaceResultMessage,
  ApprovalAnswerMessage,
  TerminalOpenedMessage,
  TerminalOutputMessage,
  TerminalExitMessage,
  TerminalErrorMessage,
]);

export type HelloMessage = z.infer<typeof HelloMessage>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessage>;
export type PresenceMessage = z.infer<typeof PresenceMessage>;
export type ToolResultMessage = z.infer<typeof ToolResultMessage>;
export type WorkspaceResultMessage = z.infer<typeof WorkspaceResultMessage>;
export type ApprovalAnswerMessage = z.infer<typeof ApprovalAnswerMessage>;
export type ExecutorMessage = z.infer<typeof ExecutorMessage>;

// ---------------------------------------------------------------------------
// Relay → CLI
// ---------------------------------------------------------------------------

export const HelloAckMessage = z.object({
  type: z.literal("hello.ack"),
  serverTime: z.number().int(),
  heartbeatIntervalMs: z.number().int(),
  /**
   * The newest CLI the gateway knows about, so `connect` can say a newer one
   * exists.
   *
   * It comes from gateway configuration rather than querying a release service
   * on every connect. Optional because a gateway predating the field sends none,
   * and because the value is configuration that may simply be unset.
   */
  latestCliVersion: z.string().optional(),
  /** Present only when fixed heartbeat frames are handled at the edge. */
  heartbeatMode: z.literal("auto").optional(),
});

export const HeartbeatAckMessage = z.object({
  type: z.literal("heartbeat.ack"),
});

export const ToolCallMessage = z.object({
  type: z.literal("tool.call"),
  requestId: z.string(),
  projectId: z.string(),
  worktreeId: z.string().optional(),
  worktreeSlug: z.string().optional(),
  tool: z.enum(TOOL_NAMES),
  arguments: z.unknown(),
  /**
   * Which AI client asked, for the line `exeora connect` prints. Optional in
   * both directions on purpose, so it needed no version bump: an older CLI
   * strips the key it does not know, and a newer one tolerates a gateway that
   * does not send it. It is also genuinely absent sometimes, because not every
   * client registers a name or announces itself over MCP.
   */
  client: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  /**
   * What this project allows, as the account holds it.
   *
   * Sent per call rather than once at `hello`, so changing a project's policy
   * in the dashboard takes effect on the next call instead of on the next
   * reconnect. Optional for the same reason `client` is: an older CLI drops the
   * key, and the gateway has already applied the policy itself before sending,
   * which is why an older CLI is not a hole.
   *
   * The executor narrows this with the project's own `exeora.toml`, if it has
   * one, and never widens it.
   */
  policy: CommandPolicy.optional(),
  issuedAt: z.number().int(),
  /**
   * Absolute deadline. The executor must not start work after this instant;
   * a stale call arriving after a reconnect is exactly the "command runs hours
   * later" hazard we refuse to accept.
   */
  expiresAt: z.number().int(),
});

export const CancelMessage = z.object({
  type: z.literal("cancel"),
  requestId: z.string(),
});

export const WorkspaceCallMessage = z.object({
  type: z.literal("workspace.call"),
  requestId: z.string(),
  projectId: z.string(),
  worktreeId: z.string().optional(),
  worktreeSlug: z.string().optional(),
  action: WorkspaceAction,
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
});

/** Sent when the device is revoked or the protocol version is rejected. */
export const ShutdownMessage = z.object({
  type: z.literal("shutdown"),
  reason: z.string(),
});

/**
 * Asking the person at this machine before a call runs.
 *
 * The path for clients that cannot be asked over MCP, which today is most of
 * them. Sent only to an executor that announced `capabilities.prompt`, so an
 * older CLI is never sent a question it would drop on the floor.
 *
 * Worth noting what is *not* here: no signature, and no hash of the arguments.
 * The elicitation path needs both because its state travels out through the AI
 * client and comes back as attacker-controlled input. This one never leaves the
 * relay, which holds the arguments itself for the whole exchange, so there is
 * nothing to bind and nothing to forge.
 */
export const ApprovalRequestMessage = z.object({
  type: z.literal("approval.request"),
  id: z.string(),
  projectId: z.string(),
  worktreeId: z.string().optional(),
  worktreeSlug: z.string().optional(),
  tool: z.enum(TOOL_NAMES),
  /** One line, already written for a person: "Run `npm test`?" */
  prompt: z.string(),
  /** Which AI client is asking, when the gateway could name one. */
  client: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  expiresAt: z.number().int(),
});

/**
 * The question is over: answered somewhere else, or nobody answered in time.
 *
 * Sent so the terminal can take its prompt down. Without it, a question already
 * settled in the dashboard would sit there waiting, and typing an answer into
 * it would do nothing, which is worse than no prompt at all.
 */
export const ApprovalResolvedMessage = z.object({
  type: z.literal("approval.resolved"),
  id: z.string(),
});

export const RelayMessage = z.discriminatedUnion("type", [
  HelloAckMessage,
  HeartbeatAckMessage,
  ToolCallMessage,
  WorkspaceCallMessage,
  CancelMessage,
  ShutdownMessage,
  ApprovalRequestMessage,
  ApprovalResolvedMessage,
  TerminalOpenMessage,
  TerminalInputMessage,
  TerminalResizeMessage,
  TerminalCloseMessage,
]);

export type HelloAckMessage = z.infer<typeof HelloAckMessage>;
export type HeartbeatAckMessage = z.infer<typeof HeartbeatAckMessage>;
export type ToolCallMessage = z.infer<typeof ToolCallMessage>;
export type WorkspaceCallMessage = z.infer<typeof WorkspaceCallMessage>;
export type CancelMessage = z.infer<typeof CancelMessage>;
export type ShutdownMessage = z.infer<typeof ShutdownMessage>;
export type ApprovalRequestMessage = z.infer<typeof ApprovalRequestMessage>;
export type ApprovalResolvedMessage = z.infer<typeof ApprovalResolvedMessage>;
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
