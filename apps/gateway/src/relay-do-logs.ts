/**
 * The live log of a machine's calls, for the dashboard's Logs view.
 *
 * What `exeora connect` prints on the machine, a line when a call starts and
 * one when it ends, sent to whichever dashboard tabs are watching the project
 * root or workspace the call ran in. With one thing the CLI leaves out: what
 * the call was about, the command it runs or the path it touches, which is
 * what someone watching an agent wants to read.
 *
 * None of it is written anywhere. Each line goes to the sockets open at that
 * moment and is gone, the way an approval's question is: a tab opened later
 * sees what is still running, not what already ran. The record of what ran,
 * without its arguments, is the audit's, and stays what it was.
 */

/** Every logs socket carries this tag, and one naming its project. */
export const LOGS_TAG = "logs";

/** How much of a call's subject a line quotes. */
const MAX_SUMMARY = 400;

/** A call being logged, kept on its caller socket until it ends. */
export interface LoggedCall {
  /** The tool as the CLI prints it: `run_command`, or `server/tool` for a proxied one. */
  tool: string;
  kind: "tool" | "mcp";
  /** What the call is about, one line; empty when nothing is worth quoting. */
  summary: string;
  projectId: string;
  workspaceId?: string;
  /** The client that made the call, as `name version`. */
  client?: string;
  startedAt: number;
}

export interface LogsSocketState {
  role: "logs";
  id: string;
  projectId: string;
  workspaceId?: string;
  settled: boolean;
}

export type LogEvent =
  | {
      type: "log.start";
      id: string;
      at: number;
      kind: "tool" | "mcp";
      tool: string;
      summary: string;
      client?: string;
    }
  | {
      type: "log.end";
      id: string;
      at: number;
      tool: string;
      ok: boolean;
      durationMs: number;
      errorCode?: string;
    };

function projectTag(projectId: string): string {
  return `${LOGS_TAG}:${projectId}`;
}

/**
 * Takes a dashboard tab's socket. The Worker has checked the ticket; this
 * only says which root or workspace the tab is watching, and tells it about
 * the calls that are running there now.
 */
export function acceptLogsSocket(
  ctx: DurableObjectState,
  url: URL,
  client: WebSocket,
  server: WebSocket,
): Response {
  const id = url.searchParams.get("id");
  const projectId = url.searchParams.get("projectId");
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  if (!id || !projectId) return new Response("Invalid logs request.", { status: 400 });
  ctx.acceptWebSocket(server, [LOGS_TAG, projectTag(projectId)]);
  server.serializeAttachment({
    role: "logs",
    id,
    projectId,
    ...(workspaceId ? { workspaceId } : {}),
    settled: false,
  } satisfies LogsSocketState);
  for (const caller of ctx.getWebSockets("tool")) {
    const state = caller.deserializeAttachment() as {
      id?: string;
      settled?: boolean;
      log?: LoggedCall;
    } | null;
    if (!state?.id || state.settled || !state.log) continue;
    if (!watches(projectId, workspaceId, state.log)) continue;
    send(server, startEvent(state.id, state.log));
  }
  return new Response(null, { status: 101, webSocket: client });
}

/** Tells the watching tabs a call went down to the machine. */
export function logStart(ctx: DurableObjectState, requestId: string, log: LoggedCall): void {
  broadcast(ctx, log, startEvent(requestId, log));
}

/** Tells the watching tabs how a call ended, and how long it took. */
export function logEnd(
  ctx: DurableObjectState,
  requestId: string,
  log: LoggedCall,
  outcome: { ok: boolean; errorCode?: string | undefined },
): void {
  const at = Date.now();
  broadcast(ctx, log, {
    type: "log.end",
    id: requestId,
    at,
    tool: log.tool,
    ok: outcome.ok,
    durationMs: Math.max(0, at - log.startedAt),
    ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
  });
}

/** Closes every watching tab, for a device that was revoked. */
export function closeLogSockets(ctx: DurableObjectState, reason: string): void {
  for (const socket of ctx.getWebSockets(LOGS_TAG)) {
    try {
      socket.close(1008, reason);
    } catch {
      // Already gone.
    }
  }
}

/**
 * What a native tool's call is about: the command it runs, the process it
 * talks to, what it searches for, the path it reads or writes, the branch or
 * workspace it manages. The caller's own arguments, shown back to their owner.
 */
export function summarizeCall(tool: string, args: unknown): string {
  const record = (args !== null && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const text = (key: string) => {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const command = text("command");
  if ((tool === "run_command" || tool === "start_command") && command) {
    const cwd = text("cwd");
    return clip(cwd && cwd !== "." ? `${command}  (in ${cwd})` : command);
  }
  const processId = text("processId");
  if (processId) return clip(`process ${processId}`);
  const pattern = text("pattern");
  const path = text("path");
  if (pattern) return clip(path ? `${pattern}  (in ${path})` : pattern);
  if (path) return clip(path);
  const branch = text("branch");
  if (branch) return clip(`branch ${branch}`);
  const workspace = text("workspace");
  if (workspace) return clip(`workspace ${workspace}`);
  const name = text("name");
  return name ? clip(name) : "";
}

/** A proxied MCP call's arguments, as far as a line can carry them. */
export function summarizeMcpCall(args: unknown): string {
  const empty =
    args === undefined ||
    args === null ||
    (typeof args === "object" && Object.keys(args as object).length === 0);
  return empty ? "" : clip(JSON.stringify(args) ?? "");
}

/** The client of a call, the way the CLI names it: `name version`. */
export function describeClient(
  client: { name?: string | undefined; version?: string | undefined } | undefined,
): string | undefined {
  if (!client?.name) return undefined;
  return client.version ? `${client.name} ${client.version}` : client.name;
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_SUMMARY ? `${line.slice(0, MAX_SUMMARY - 1)}…` : line;
}

function watches(projectId: string, workspaceId: string | undefined, log: LoggedCall): boolean {
  return log.projectId === projectId && (log.workspaceId ?? null) === (workspaceId ?? null);
}

function startEvent(requestId: string, log: LoggedCall): LogEvent {
  return {
    type: "log.start",
    id: requestId,
    at: log.startedAt,
    kind: log.kind,
    tool: log.tool,
    summary: log.summary,
    ...(log.client ? { client: log.client } : {}),
  };
}

function broadcast(ctx: DurableObjectState, log: LoggedCall, event: LogEvent): void {
  const sockets = ctx.getWebSockets(projectTag(log.projectId));
  if (sockets.length === 0) return;
  const frame = JSON.stringify(event);
  for (const socket of sockets) {
    const state = socket.deserializeAttachment() as LogsSocketState | null;
    if (state?.role !== "logs" || !watches(state.projectId, state.workspaceId, log)) continue;
    send(socket, frame);
  }
}

function send(socket: WebSocket, event: LogEvent | string): void {
  try {
    socket.send(typeof event === "string" ? event : JSON.stringify(event));
  } catch {
    // A tab that went away is closed by its own close handler.
  }
}
