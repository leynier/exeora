import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import {
  appendEvent,
  appendNote,
  isHeartbeatAck,
  type LogLine,
  parseLogEvent,
} from "./logsModel.js";

const HEARTBEAT_REQUEST = '{"type":"heartbeat"}';
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;
/** How long to wait before trying again, one step further each time it fails. */
const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export type LogsStatus = "idle" | "connecting" | "live" | "reconnecting";

export type WorkspaceLogs = {
  lines: readonly LogLine[];
  status: LogsStatus;
  clear: () => void;
};

/**
 * The live log of the calls on one root or workspace, for as long as the
 * Workspace screen is open on it.
 *
 * Nothing is fetched until the Logs view is first shown, since watching costs
 * a socket; from then on the socket stays up while other views are shown, so
 * switching back finds every line that arrived meanwhile. It reconnects on
 * its own, with a new ticket each time, and says so in the log. Another
 * target, and it starts over.
 */
export function useWorkspaceLogs({
  projectId,
  workspace,
  targetKey,
  active,
}: {
  projectId: string;
  /** The workspace id, or the selector of another location's root; none for the default root. */
  workspace: string | undefined;
  targetKey: string;
  /** Whether the Logs view is on screen now. */
  active: boolean;
}): WorkspaceLogs {
  const [lines, setLines] = useState<readonly LogLine[]>([]);
  const [status, setStatus] = useState<LogsStatus>("idle");
  const [watching, setWatching] = useState<string | null>(null);
  const key = `${projectId}:${targetKey}`;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  // Another target starts over, before anything of the last one is drawn.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setLines([]);
    setStatus("idle");
  }
  // Starts on the first visit to the view, and forgets it for another target.
  useEffect(() => {
    if (active && projectId) setWatching(key);
  }, [active, projectId, key]);

  useEffect(() => {
    if (watching !== key) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let heartbeat: number | undefined;
    let failures = 0;

    const schedule = () => {
      if (disposed) return;
      setStatus("reconnecting");
      const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)] ?? 30_000;
      failures += 1;
      retry = window.setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (disposed) return;
      setStatus((current) => (current === "idle" ? "connecting" : current));
      let url: URL;
      try {
        const ticket = await api.logsTicket(projectId, workspaceRef.current);
        url = new URL(ticket.url);
      } catch {
        schedule();
        return;
      }
      if (disposed) return;
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket = ws;
      let lastAck = Date.now();
      ws.addEventListener("open", () => {
        if (disposed) return;
        if (failures > 0) setLines((current) => appendNote(current, "Reconnected."));
        failures = 0;
        setStatus("live");
        heartbeat = window.setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastAck > HEARTBEAT_TIMEOUT_MS) {
            ws.close(4001, "heartbeat timeout");
            return;
          }
          ws.send(HEARTBEAT_REQUEST);
        }, HEARTBEAT_INTERVAL_MS);
      });
      ws.addEventListener("message", (message) => {
        if (disposed) return;
        const raw = String(message.data);
        if (isHeartbeatAck(raw)) {
          lastAck = Date.now();
          return;
        }
        const event = parseLogEvent(raw);
        if (event) setLines((current) => appendEvent(current, event));
      });
      ws.addEventListener("close", () => {
        window.clearInterval(heartbeat);
        if (disposed || socket !== ws) return;
        if (failures === 0) {
          setLines((current) => appendNote(current, "Connection lost. Reconnecting…"));
        }
        schedule();
      });
    };

    void connect();
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      window.clearInterval(heartbeat);
      socket?.close(1000, "done");
    };
  }, [watching, key, projectId]);

  const clear = useCallback(() => setLines([]), []);
  return { lines, status: watching === key ? status : "idle", clear };
}
