import { encodeMessage } from "@exeora/protocol";
import { touchDevice } from "./presence.js";
import {
  attachmentOf,
  executorSocket,
  failCallers,
  failTerminalViewers,
  type TerminalCallerState,
} from "./relay-do-callers.js";

export const TERMINAL_IDLE_MS = 30 * 60_000;
export const TERMINAL_MAX_DURATION_MS = 8 * 60 * 60_000;
export const TERMINAL_TICKET_MS = 30_000;
export const TERMINAL_TICKET_PREFIX = "terminal-ticket:";
export const TERMINAL_SESSION_PREFIX = "terminal-session:";

const MAX_REPLAY_BYTES = 32 * 1024;
// Below the roughly ten idle seconds after which a hibernatable object leaves
// memory, so the trailing flush alarm fires before buffered output could go.
const DETACHED_TOUCH_MS = 5_000;

export type StoredTerminalSession = {
  sessionId: string;
  projectId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  targetKey: string;
  startedAt: number;
  lastActivityAt: number;
  replay: string[];
  replayBytes: number;
};

export type ListedTerminal = {
  sessionId: string;
  projectId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  startedAt: number;
};

type ReplayBuffer = { replay: string[]; replayBytes: number; seeded: boolean };

// In memory only. After a hibernation wake the buffer restarts unseeded, and
// persisting it must then append to the stored replay rather than replace it.
const replayBySocket = new WeakMap<WebSocket, ReplayBuffer>();
const lastDetachedTouch = new Map<string, number>();
// Detached output is buffered here and written at most once per touch window.
const pendingDetached = new Map<string, StoredTerminalSession>();

export function terminalTargetKey(projectId: string, workspaceId: string | undefined): string {
  return `${projectId}:${workspaceId ?? "main"}`;
}

export async function listStoredTerminals(
  ctx: DurableObjectState,
): Promise<StoredTerminalSession[]> {
  const rows = await ctx.storage.list<StoredTerminalSession>({
    prefix: TERMINAL_SESSION_PREFIX,
  });
  return [...rows.values()];
}

export async function listTerminalSummaries(ctx: DurableObjectState): Promise<ListedTerminal[]> {
  return (await listStoredTerminals(ctx)).map((session) => ({
    sessionId: session.sessionId,
    projectId: session.projectId,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.workspaceSlug ? { workspaceSlug: session.workspaceSlug } : {}),
    startedAt: session.startedAt,
  }));
}

export async function storedTerminalByTarget(
  ctx: DurableObjectState,
  targetKey: string,
): Promise<StoredTerminalSession | undefined> {
  return ctx.storage.get<StoredTerminalSession>(`${TERMINAL_SESSION_PREFIX}${targetKey}`);
}

export async function storedTerminalById(
  ctx: DurableObjectState,
  sessionId: string,
): Promise<StoredTerminalSession | undefined> {
  return (await listStoredTerminals(ctx)).find((session) => session.sessionId === sessionId);
}

export async function putStoredTerminal(
  ctx: DurableObjectState,
  session: StoredTerminalSession,
): Promise<void> {
  await ctx.storage.put(`${TERMINAL_SESSION_PREFIX}${session.targetKey}`, session);
}

export async function forgetStoredTerminal(
  ctx: DurableObjectState,
  sessionId: string,
): Promise<void> {
  lastDetachedTouch.delete(sessionId);
  pendingDetached.delete(sessionId);
  const session = await storedTerminalById(ctx, sessionId);
  if (session) await ctx.storage.delete(`${TERMINAL_SESSION_PREFIX}${session.targetKey}`);
}

export async function forgetAllStoredTerminals(ctx: DurableObjectState): Promise<void> {
  lastDetachedTouch.clear();
  pendingDetached.clear();
  const rows = await ctx.storage.list({ prefix: TERMINAL_SESSION_PREFIX });
  const keys = [...rows.keys()];
  if (keys.length > 0) await ctx.storage.delete(keys);
}

export function appendReplay(
  buffer: { replay: string[]; replayBytes: number },
  chunk: string,
): void {
  buffer.replay.push(chunk);
  buffer.replayBytes += chunk.length;
  while (buffer.replayBytes > MAX_REPLAY_BYTES && buffer.replay.length > 1) {
    const removed = buffer.replay.shift();
    if (removed) buffer.replayBytes -= removed.length;
  }
}

export function recordSocketReplay(socket: WebSocket, chunk: string): void {
  let buffer = replayBySocket.get(socket);
  if (!buffer) {
    buffer = { replay: [], replayBytes: 0, seeded: false };
    replayBySocket.set(socket, buffer);
  }
  appendReplay(buffer, chunk);
}

export function seedSocketReplay(socket: WebSocket, session: StoredTerminalSession): void {
  replayBySocket.set(socket, {
    replay: [...session.replay],
    replayBytes: session.replayBytes,
    seeded: true,
  });
}

export function socketReplay(socket: WebSocket): ReplayBuffer | undefined {
  return replayBySocket.get(socket);
}

export function sendExecutorTerminalClose(ctx: DurableObjectState, sessionId: string): void {
  try {
    executorSocket(ctx)?.send(encodeMessage({ type: "terminal.close", sessionId }));
  } catch {
    // Executor is already gone.
  }
}

export async function destroyTerminalSession(
  ctx: DurableObjectState,
  sessionId: string,
): Promise<void> {
  sendExecutorTerminalClose(ctx, sessionId);
  await forgetStoredTerminal(ctx, sessionId);
}

export function liveTerminalForTarget(
  ctx: DurableObjectState,
  targetKey: string,
): WebSocket | undefined {
  return ctx.getWebSockets("terminal").find((socket) => {
    const state = attachmentOf(socket);
    return state?.role === "terminal" && !state.settled && state.targetKey === targetKey;
  });
}

export function liveTerminalForSession(
  ctx: DurableObjectState,
  sessionId: string,
): WebSocket | undefined {
  return ctx.getWebSockets("terminal").find((socket) => {
    const state = attachmentOf(socket);
    return state?.role === "terminal" && !state.settled && state.id === sessionId;
  });
}

export async function persistDetachedTerminal(
  ctx: DurableObjectState,
  socket: WebSocket,
  state: TerminalCallerState,
): Promise<void> {
  const stored = (await storedTerminalById(ctx, state.id)) ?? {
    sessionId: state.id,
    projectId: state.projectId,
    ...(state.workspaceId ? { workspaceId: state.workspaceId } : {}),
    ...(state.workspaceSlug ? { workspaceSlug: state.workspaceSlug } : {}),
    targetKey: state.targetKey,
    startedAt: state.startedAt,
    lastActivityAt: state.lastActivityAt,
    replay: [],
    replayBytes: 0,
  };
  stored.lastActivityAt = Math.max(stored.lastActivityAt, state.lastActivityAt);
  // The socket's buffer is newer than anything queued while nobody watched.
  pendingDetached.delete(state.id);
  const buffer = socketReplay(socket);
  if (buffer?.seeded) {
    stored.replay = buffer.replay;
    stored.replayBytes = buffer.replayBytes;
  } else if (buffer) {
    for (const chunk of buffer.replay) appendReplay(stored, chunk);
  }
  await putStoredTerminal(ctx, stored);
  await scheduleWorkspaceAlarm(ctx);
}

export async function touchDetachedSession(
  ctx: DurableObjectState,
  sessionId: string,
  chunk?: string,
): Promise<void> {
  const stored = pendingDetached.get(sessionId) ?? (await storedTerminalById(ctx, sessionId));
  if (!stored) return;
  const now = Date.now();
  if (chunk) appendReplay(stored, chunk);
  stored.lastActivityAt = now;
  const queued = pendingDetached.has(sessionId);
  pendingDetached.set(sessionId, stored);
  // A busy detached shell (a build, `tail -f`) would otherwise write storage on
  // every chunk. Anything newer than the last write lives in memory until the
  // window ends, a reattach reads the row, or the trailing alarm flushes it.
  const previous = lastDetachedTouch.get(sessionId) ?? 0;
  if (now - previous >= DETACHED_TOUCH_MS) {
    await flushDetachedSession(ctx, sessionId);
    await scheduleWorkspaceAlarm(ctx);
    return;
  }
  if (queued) return;
  // Nothing else wakes the object once output stops, and hibernation would
  // drop the buffer, so the end of the window is an alarm.
  const due = previous + DETACHED_TOUCH_MS;
  const alarm = await ctx.storage.getAlarm();
  if (alarm === null || alarm > due) await ctx.storage.setAlarm(due);
}

export async function flushAllDetached(ctx: DurableObjectState): Promise<void> {
  for (const sessionId of [...pendingDetached.keys()]) {
    await flushDetachedSession(ctx, sessionId);
  }
}

export async function flushDetachedSession(
  ctx: DurableObjectState,
  sessionId: string,
): Promise<void> {
  const pending = pendingDetached.get(sessionId);
  if (!pending) return;
  pendingDetached.delete(sessionId);
  lastDetachedTouch.set(sessionId, Date.now());
  await putStoredTerminal(ctx, pending);
}

/**
 * The later of the stored and the attached socket's activity. While a browser
 * is attached, typing and output only touch the socket attachment, so the row
 * alone would expire a terminal that is in active use.
 */
export function lastTerminalActivity(
  ctx: DurableObjectState,
  session: StoredTerminalSession,
): number {
  const socket = liveTerminalForSession(ctx, session.sessionId);
  const state = socket ? attachmentOf(socket) : null;
  return state?.role === "terminal"
    ? Math.max(session.lastActivityAt, state.lastActivityAt)
    : session.lastActivityAt;
}

export async function scheduleWorkspaceAlarm(ctx: DurableObjectState): Promise<void> {
  const deadlines = ctx
    .getWebSockets("terminal")
    .map(attachmentOf)
    .filter((state): state is TerminalCallerState => state?.role === "terminal" && !state.settled)
    .flatMap((state) => [
      state.lastActivityAt + TERMINAL_IDLE_MS,
      state.startedAt + TERMINAL_MAX_DURATION_MS,
    ]);
  for (const session of await listStoredTerminals(ctx)) {
    deadlines.push(
      lastTerminalActivity(ctx, session) + TERMINAL_IDLE_MS,
      session.startedAt + TERMINAL_MAX_DURATION_MS,
    );
  }
  for (const sessionId of pendingDetached.keys()) {
    deadlines.push((lastDetachedTouch.get(sessionId) ?? 0) + DETACHED_TOUCH_MS);
  }
  const tickets = await ctx.storage.list<{ expiresAt: number }>({
    prefix: TERMINAL_TICKET_PREFIX,
  });
  deadlines.push(...[...tickets.values()].map((ticket) => ticket.expiresAt));
  if (deadlines.length === 0) {
    await ctx.storage.deleteAlarm();
    return;
  }
  await ctx.storage.setAlarm(Math.max(Date.now() + 1_000, Math.min(...deadlines)));
}

/**
 * PTYs die with the executor process; dashboard viewers must detach with them.
 *
 * A replaced executor is the exception: the replacement's `hello` already reset
 * every terminal, and anything opened since belongs to the new process.
 */
export async function dropExecutor(
  ctx: DurableObjectState,
  env: Pick<Env, "DB">,
  deviceId: string,
  replaced: boolean,
  reason: string,
): Promise<void> {
  await touchDevice(env, deviceId, { force: true, connected: replaced });
  if (replaced) return;
  failTerminalViewers(ctx, reason);
  await forgetAllStoredTerminals(ctx);
  failCallers(ctx, reason);
}

/**
 * A new executor never owns an earlier connection's PTYs: every CLI kills its
 * shells when its socket drops. Rows that outlived a close this object never
 * saw (a deploy, an eviction) would otherwise list and reattach dead sessions.
 */
export async function resetExecutorTerminals(ctx: DurableObjectState): Promise<void> {
  failTerminalViewers(ctx, "The machine reconnected, so its terminals were closed.");
  await forgetAllStoredTerminals(ctx);
  await scheduleWorkspaceAlarm(ctx);
}
