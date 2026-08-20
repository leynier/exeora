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

const TERMINAL_IDLE_MS = 30 * 60_000;
const TERMINAL_MAX_DURATION_MS = 8 * 60 * 60_000;
const TERMINAL_TICKET_MS = 30_000;
const TERMINAL_TICKET_PREFIX = "terminal-ticket:";

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
  const id = url.searchParams.get("id");
  const projectId = url.searchParams.get("projectId");
  const worktreeId = url.searchParams.get("worktreeId") ?? undefined;
  const worktreeSlug = url.searchParams.get("worktreeSlug") ?? undefined;
  const cols = Number(url.searchParams.get("cols"));
  const rows = Number(url.searchParams.get("rows"));
  if (
    !id ||
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

  const targetKey = `${projectId}:${worktreeId ?? "main"}`;
  const alreadyOpen = ctx
    .getWebSockets("terminal")
    .map(attachmentOf)
    .some((state) => state?.role === "terminal" && !state.settled && state.targetKey === targetKey);
  if (alreadyOpen) {
    return new Response("A terminal is already open for this worktree.", { status: 409 });
  }

  const now = Date.now();
  ctx.acceptWebSocket(server, ["caller", "terminal", callerTag("terminal", id)]);
  server.serializeAttachment({
    role: "terminal",
    id,
    projectId,
    ...(worktreeId ? { worktreeId } : {}),
    ...(worktreeSlug ? { worktreeSlug } : {}),
    targetKey,
    settled: false,
    startedAt: now,
    lastActivityAt: now,
  } satisfies TerminalCallerState);
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
  await scheduleWorkspaceAlarm(ctx);
  return new Response(null, { status: 101, webSocket: client });
}

export function forwardTerminalMessage(
  ctx: DurableObjectState,
  message: TerminalExecutorMessage,
): void {
  const caller = callerSocket(ctx, "terminal", message.sessionId);
  if (!caller) return;
  try {
    caller.send(encodeMessage(message));
  } catch {
    closeTerminalSession(ctx, message.sessionId);
    return;
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
  if (message.type === "terminal.exit" || message.type === "terminal.error") {
    if (message.type === "terminal.error") closeTerminalSession(ctx, message.sessionId);
    caller.close(message.type === "terminal.exit" ? 1000 : 1011, message.type);
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
  }
  if (message.type === "terminal.close") {
    socket.serializeAttachment({ ...state, settled: true } satisfies TerminalCallerState);
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

  for (const socket of ctx.getWebSockets("terminal")) {
    const state = attachmentOf(socket);
    if (
      state?.role === "terminal" &&
      (now - state.lastActivityAt >= TERMINAL_IDLE_MS ||
        now - state.startedAt >= TERMINAL_MAX_DURATION_MS)
    ) {
      try {
        socket.send(
          JSON.stringify({
            type: "terminal.error",
            sessionId: state.id,
            message: "Terminal session expired.",
          }),
        );
      } catch {
        // Already disconnected.
      }
      closeTerminalSession(ctx, state.id);
      socket.close(1000, "terminal expired");
    }
  }
  await scheduleWorkspaceAlarm(ctx);
}

export function closeTerminalSession(ctx: DurableObjectState, sessionId: string): void {
  try {
    executorSocket(ctx)?.send(encodeMessage({ type: "terminal.close", sessionId }));
  } catch {
    // Executor is already gone.
  }
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
