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
const DETACHED_TOUCH_MS = 10_000;

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

const replayBySocket = new WeakMap<WebSocket, { replay: string[]; replayBytes: number }>();
const lastDetachedTouch = new Map<string, number>();

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
  const session = await storedTerminalById(ctx, sessionId);
  if (session) await ctx.storage.delete(`${TERMINAL_SESSION_PREFIX}${session.targetKey}`);
}

export async function forgetAllStoredTerminals(ctx: DurableObjectState): Promise<void> {
  lastDetachedTouch.clear();
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
    buffer = { replay: [], replayBytes: 0 };
    replayBySocket.set(socket, buffer);
  }
  appendReplay(buffer, chunk);
}

export function seedSocketReplay(socket: WebSocket, session: StoredTerminalSession): void {
  replayBySocket.set(socket, {
    replay: [...session.replay],
    replayBytes: session.replayBytes,
  });
}

export function socketReplay(
  socket: WebSocket,
): { replay: string[]; replayBytes: number } | undefined {
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
  stored.lastActivityAt = state.lastActivityAt;
  const buffer = socketReplay(socket);
  if (buffer) {
    stored.replay = buffer.replay;
    stored.replayBytes = buffer.replayBytes;
  }
  await putStoredTerminal(ctx, stored);
  await scheduleWorkspaceAlarm(ctx);
}

export async function touchDetachedSession(
  ctx: DurableObjectState,
  sessionId: string,
  chunk?: string,
): Promise<void> {
  const stored = await storedTerminalById(ctx, sessionId);
  if (!stored) return;
  const now = Date.now();
  if (chunk) appendReplay(stored, chunk);
  stored.lastActivityAt = now;
  const previous = lastDetachedTouch.get(sessionId) ?? 0;
  if (now - previous < DETACHED_TOUCH_MS && !chunk) return;
  lastDetachedTouch.set(sessionId, now);
  await putStoredTerminal(ctx, stored);
  await scheduleWorkspaceAlarm(ctx);
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
      session.lastActivityAt + TERMINAL_IDLE_MS,
      session.startedAt + TERMINAL_MAX_DURATION_MS,
    );
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

/** PTYs die with the executor process; dashboard viewers must detach with them. */
export async function dropExecutor(
  ctx: DurableObjectState,
  env: Pick<Env, "DB">,
  deviceId: string,
  replaced: boolean,
  reason: string,
): Promise<void> {
  await touchDevice(env, deviceId, { force: true, connected: replaced });
  failTerminalViewers(ctx, reason);
  await forgetAllStoredTerminals(ctx);
  if (!replaced) failCallers(ctx, reason);
}
