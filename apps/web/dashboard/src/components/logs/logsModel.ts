/**
 * The Logs view's lines, as data: what the gateway sends while a tab watches a
 * root or workspace, and the lines those events become.
 *
 * The lines read like the ones `exeora connect` prints on the machine, an
 * arrow when a call starts and a tick or a cross when it ends, with what the
 * call is about after the tool. Nothing here is stored: the lines live in the
 * tab for as long as it is open.
 */

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
    }
  | { type: "log.sync"; at: number; running: string[] };

export type LogLine =
  | {
      key: string;
      kind: "start";
      at: number;
      tool: string;
      mcp: boolean;
      summary: string;
      client?: string;
    }
  | {
      key: string;
      kind: "end";
      at: number;
      tool: string;
      /** Null for a call that ended while the tab was disconnected, how is not known. */
      ok: boolean | null;
      durationMs?: number;
      errorCode?: string;
    }
  | { key: string; kind: "note"; at: number; text: string };

/** How many lines a tab keeps before dropping the oldest. */
export const MAX_LINES = 1000;

/** An event off the socket, or null for anything else: a heartbeat's answer, a stray frame. */
export function parseLogEvent(raw: string): LogEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.type === "log.sync" && typeof event.at === "number" && Array.isArray(event.running)) {
    return {
      type: "log.sync",
      at: event.at,
      running: event.running.filter((id): id is string => typeof id === "string"),
    };
  }
  if (typeof event.id !== "string" || typeof event.at !== "number") return null;
  if (typeof event.tool !== "string") return null;
  if (event.type === "log.start") {
    return {
      type: "log.start",
      id: event.id,
      at: event.at,
      kind: event.kind === "mcp" ? "mcp" : "tool",
      tool: event.tool,
      summary: typeof event.summary === "string" ? event.summary : "",
      ...(typeof event.client === "string" ? { client: event.client } : {}),
    };
  }
  if (event.type === "log.end" && typeof event.ok === "boolean") {
    return {
      type: "log.end",
      id: event.id,
      at: event.at,
      tool: event.tool,
      ok: event.ok,
      durationMs: typeof event.durationMs === "number" ? event.durationMs : 0,
      ...(typeof event.errorCode === "string" ? { errorCode: event.errorCode } : {}),
    };
  }
  return null;
}

/**
 * The lines with one more event. A start or an end already shown is not
 * shown twice: a socket that reconnects is told again about what is running.
 */
export function appendEvent(lines: readonly LogLine[], event: LogEvent): LogLine[] {
  if (event.type === "log.sync") return settleMissing(lines, event.running, event.at);
  const key = `${event.type === "log.start" ? "start" : "end"}:${event.id}`;
  if (lines.some((line) => line.key === key)) return lines as LogLine[];
  const line: LogLine =
    event.type === "log.start"
      ? {
          key,
          kind: "start",
          at: event.at,
          tool: event.tool,
          mcp: event.kind === "mcp",
          summary: event.summary,
          ...(event.client ? { client: event.client } : {}),
        }
      : {
          key,
          kind: "end",
          at: event.at,
          tool: event.tool,
          ok: event.ok,
          durationMs: event.durationMs,
          ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        };
  return trimmed([...lines, line]);
}

/**
 * Ends every line still shown running whose call the relay no longer has: it
 * finished while this tab was not connected, and how it ended is not known.
 * Nothing is invented for calls this tab never saw start.
 */
function settleMissing(
  lines: readonly LogLine[],
  running: readonly string[],
  at: number,
): LogLine[] {
  const still = new Set(running);
  const ended = new Set(
    lines.filter((line) => line.kind === "end").map((line) => line.key.slice(4)),
  );
  const lost: LogLine[] = [];
  for (const line of lines) {
    if (line.kind !== "start") continue;
    const id = line.key.slice(6);
    if (ended.has(id) || still.has(id)) continue;
    lost.push({ key: `end:${id}`, kind: "end", at, tool: line.tool, ok: null });
  }
  return lost.length > 0 ? trimmed([...lines, ...lost]) : (lines as LogLine[]);
}

/** Whether a frame is the relay's answer to a heartbeat. */
export function isHeartbeatAck(raw: string): boolean {
  try {
    const value = JSON.parse(raw) as { type?: unknown } | null;
    return value?.type === "heartbeat.ack";
  } catch {
    return false;
  }
}

/** A line of the view's own, such as the connection dropping. */
export function appendNote(lines: readonly LogLine[], text: string, at = Date.now()): LogLine[] {
  return trimmed([...lines, { key: `note:${at}:${lines.length}`, kind: "note", at, text }]);
}

/** Which calls have started and not ended, for the header to count. */
export function runningCount(lines: readonly LogLine[]): number {
  const ended = new Set(
    lines.filter((line) => line.kind === "end").map((line) => line.key.slice(4)),
  );
  return lines.filter((line) => line.kind === "start" && !ended.has(line.key.slice(6))).length;
}

/** `09:14:03`, in the viewer's time. */
export function formatClock(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** `840ms`, `12.4s`, `3m 05s`: short at any length. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function trimmed(lines: LogLine[]): LogLine[] {
  return lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
}
