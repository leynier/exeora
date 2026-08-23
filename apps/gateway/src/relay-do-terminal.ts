import {
  encodeMessage,
  TerminalCloseMessage,
  type TerminalErrorMessage,
  type TerminalExitMessage,
  TerminalInputMessage,
  type TerminalOpenedMessage,
  type TerminalOutputMessage,
  TerminalResizeMessage,
} from "@exeora/protocol";
import {
  attachmentOf,
  callerSocket,
  callerTag,
  executorSocket,
  type TerminalCallerState,
} from "./relay-do-callers.js";
import {
  destroyTerminalSession,
  forgetStoredTerminal,
  listStoredTerminals,
  liveTerminalForSession,
  liveTerminalForTarget,
  putStoredTerminal,
  recordSocketReplay,
  scheduleWorkspaceAlarm,
  seedSocketReplay,
  storedTerminalByTarget,
  TERMINAL_IDLE_MS,
  TERMINAL_MAX_DURATION_MS,
  TERMINAL_TICKET_MS,
  TERMINAL_TICKET_PREFIX,
  terminalTargetKey,
  touchDetachedSession,
} from "./relay-do-terminal-sessions.js";

type TerminalExecutorMessage =
  | TerminalOpenedMessage
  | TerminalOutputMessage
  | TerminalExitMessage
  | TerminalErrorMessage;

export async function acceptTerminalSocket(
  ctx: DurableObjectState,
  url: URL,
  client: WebSocket,
  server: WebSocket,
): Promise<Response> {
  const requestedId = url.searchParams.get("id");
  const projectId = url.searchParams.get("projectId");
  const worktreeId = url.searchParams.get("worktreeId") ?? undefined;
  const worktreeSlug = url.searchParams.get("worktreeSlug") ?? undefined;
  const cols = Number(url.searchParams.get("cols"));
  const rows = Number(url.searchParams.get("rows"));
  if (
    !requestedId ||
    !projectId ||
    !Number.isInteger(cols) ||
    cols < 20 ||
    cols > 500 ||
    !Number.isInteger(rows) ||
    rows < 5 ||
    rows > 300
  ) {
    return new Response("Invalid terminal request.", { status: 400 });
  }
  if ((worktreeId && !worktreeSlug) || (!worktreeId && worktreeSlug)) {
    return new Response("Invalid worktree target.", { status: 400 });
  }

  const executor = executorSocket(ctx);
  const executorState = executor ? attachmentOf(executor) : null;
  if (
    !executor ||
    executorState?.role !== "executor" ||
    !executorState.capabilities?.features?.includes("terminal-v1") ||
    (worktreeId !== undefined && !executorState.capabilities.worktreeRouting)
  ) {
    return new Response("The connected CLI does not support web terminals.", { status: 409 });
  }

  const targetKey = terminalTargetKey(projectId, worktreeId);
  if (liveTerminalForTarget(ctx, targetKey)) {
    return new Response("A terminal is already open for this worktree.", { status: 409 });
  }

  const stored = await storedTerminalByTarget(ctx, targetKey);
  const id = stored?.sessionId ?? requestedId;
  const now = Date.now();
  const startedAt = stored?.startedAt ?? now;
  ctx.acceptWebSocket(server, ["caller", "terminal", callerTag("terminal", id)]);
  const state: TerminalCallerState = {
    role: "terminal",
    id,
    projectId,
    ...(worktreeId ? { worktreeId } : {}),
    ...(worktreeSlug ? { worktreeSlug } : {}),
    targetKey,
    settled: false,
    startedAt,
    lastActivityAt: now,
  };
  server.serializeAttachment(state);

  const session = stored ?? {
    sessionId: id,
    projectId,
    ...(worktreeId ? { worktreeId } : {}),
    ...(worktreeSlug ? { worktreeSlug } : {}),
    targetKey,
    startedAt,
    lastActivityAt: now,
    replay: [],
    replayBytes: 0,
  };
  session.lastActivityAt = now;
  await putStoredTerminal(ctx, session);
  seedSocketReplay(server, session);

  if (stored) {
    try {
      server.send(encodeMessage({ type: "terminal.opened", sessionId: id }));
      for (const data of session.replay) {
        server.send(encodeMessage({ type: "terminal.output", sessionId: id, data }));
      }
      executor.send(encodeMessage({ type: "terminal.resize", sessionId: id, cols, rows }));
    } catch {
      // The browser or executor dropped during attach; the PTY stays for retry.
    }
  } else {
    executor.send(
      encodeMessage({
        type: "terminal.open",
        sessionId: id,
        projectId,
        worktreeId,
        worktreeSlug,
        cols,
        rows,
      }),
    );
  }
  await scheduleWorkspaceAlarm(ctx);
  return new Response(null, { status: 101, webSocket: client });
}

export function forwardTerminalMessage(
  ctx: DurableObjectState,
  message: TerminalExecutorMessage,
): void {
  const caller = callerSocket(ctx, "terminal", message.sessionId);
  if (caller) {
    try {
      caller.send(encodeMessage(message));
    } catch {
      // The browser is gone; keep the PTY until they reconnect or the session expires.
    }
    const state = attachmentOf(caller);
    if (state?.role === "terminal") {
      caller.serializeAttachment({
        ...state,
        lastActivityAt: Date.now(),
        ...(message.type === "terminal.exit" || message.type === "terminal.error"
          ? { settled: true }
          : {}),
      } satisfies TerminalCallerState);
    }
    if (message.type === "terminal.output") recordSocketReplay(caller, message.data);
  } else if (message.type === "terminal.output") {
    void touchDetachedSession(ctx, message.sessionId, message.data);
  }

  if (message.type === "terminal.exit" || message.type === "terminal.error") {
    void forgetStoredTerminal(ctx, message.sessionId);
    if (message.type === "terminal.error") void destroyTerminalSession(ctx, message.sessionId);
    caller?.close(message.type === "terminal.exit" ? 1000 : 1011, message.type);
  }
}

export function handleTerminalCallerMessage(
  ctx: DurableObjectState,
  socket: WebSocket,
  state: TerminalCallerState,
  raw: string,
): void {
  if (state.settled) return;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return;
  }
  const input = TerminalInputMessage.safeParse(value);
  const resize = TerminalResizeMessage.safeParse(value);
  const close = TerminalCloseMessage.safeParse(value);
  const message = input.success
    ? input.data
    : resize.success
      ? resize.data
      : close.success
        ? close.data
        : null;
  if (!message || message.sessionId !== state.id) return;

  socket.serializeAttachment({
    ...state,
    lastActivityAt: Date.now(),
  } satisfies TerminalCallerState);
  const executor = executorSocket(ctx);
  if (!executor) {
    socket.close(1011, "executor offline");
    return;
  }
  try {
    executor.send(encodeMessage(message));
  } catch {
    socket.close(1011, "executor offline");
    return;
  }
  if (message.type === "terminal.close") {
    socket.serializeAttachment({ ...state, settled: true } satisfies TerminalCallerState);
    void forgetStoredTerminal(ctx, state.id);
    socket.close(1000, "terminal closed");
  }
}

export async function issueTerminalTicket(
  ctx: DurableObjectState,
  projectId: string,
  worktreeId: string | undefined,
  worktreeSlug: string | undefined,
  origin: string,
): Promise<string | null> {
  const executor = executorSocket(ctx);
  const state = executor ? attachmentOf(executor) : null;
  if (
    !executor ||
    state?.role !== "executor" ||
    !state.capabilities?.features?.includes("terminal-v1") ||
    (worktreeId !== undefined && !state.capabilities.worktreeRouting)
  ) {
    return null;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await ctx.storage.put(`${TERMINAL_TICKET_PREFIX}${token}`, {
    projectId,
    worktreeId,
    worktreeSlug,
    origin,
    expiresAt: Date.now() + TERMINAL_TICKET_MS,
  });
  await scheduleWorkspaceAlarm(ctx);
  return token;
}

export async function consumeTerminalTicket(
  ctx: DurableObjectState,
  token: string,
  projectId: string,
  worktreeId: string | undefined,
  worktreeSlug: string | undefined,
  origin: string,
): Promise<boolean> {
  const consumed = await ctx.storage.transaction(async (transaction) => {
    const key = `${TERMINAL_TICKET_PREFIX}${token}`;
    const ticket = await transaction.get<{
      projectId: string;
      worktreeId?: string;
      worktreeSlug?: string;
      origin: string;
      expiresAt: number;
    }>(key);
    await transaction.delete(key);
    return Boolean(
      ticket &&
        ticket.projectId === projectId &&
        ticket.worktreeId === worktreeId &&
        ticket.worktreeSlug === worktreeSlug &&
        ticket.origin === origin &&
        ticket.expiresAt >= Date.now(),
    );
  });
  await scheduleWorkspaceAlarm(ctx);
  return consumed;
}

export async function expireWorkspaceSessions(ctx: DurableObjectState): Promise<void> {
  const now = Date.now();
  const tickets = await ctx.storage.list<{ expiresAt: number }>({
    prefix: TERMINAL_TICKET_PREFIX,
  });
  const expired = [...tickets.entries()]
    .filter(([, ticket]) => ticket.expiresAt < now)
    .map(([key]) => key);
  if (expired.length > 0) await ctx.storage.delete(expired);

  for (const session of await listStoredTerminals(ctx)) {
    if (
      now - session.lastActivityAt < TERMINAL_IDLE_MS &&
      now - session.startedAt < TERMINAL_MAX_DURATION_MS
    ) {
      continue;
    }
    const socket = liveTerminalForSession(ctx, session.sessionId);
    if (socket) {
      const state = attachmentOf(socket);
      try {
        socket.send(
          JSON.stringify({
            type: "terminal.error",
            sessionId: session.sessionId,
            message: "Terminal session expired.",
          }),
        );
      } catch {
        // Already disconnected.
      }
      if (state?.role === "terminal") {
        socket.serializeAttachment({ ...state, settled: true } satisfies TerminalCallerState);
      }
      socket.close(1000, "terminal expired");
    }
    await destroyTerminalSession(ctx, session.sessionId);
  }
  await scheduleWorkspaceAlarm(ctx);
}

export {
  dropExecutor,
  forgetAllStoredTerminals,
  type ListedTerminal,
  listTerminalSummaries,
  persistDetachedTerminal,
  scheduleWorkspaceAlarm,
} from "./relay-do-terminal-sessions.js";
