import { IconButton } from "@exeora/design/react";
import { ArrowDownToLine, Eraser } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { WorkspaceContext } from "../workspace/context.js";
import { formatClock, formatDuration, type LogLine, runningCount } from "./logsModel.js";
import type { LogsStatus } from "./useWorkspaceLogs.js";

const STATUS_LABEL: Record<LogsStatus, string> = {
  idle: "logs",
  connecting: "connecting…",
  live: "live logs",
  reconnecting: "reconnecting…",
};

/**
 * The calls agents make on the root or workspace on screen, as they run: the
 * lines `exeora connect` prints on the machine, with what each call is about.
 * Follows the newest line until the reader scrolls up, and again once they
 * scroll back down.
 */
export function LogsPanel({ ctx }: { ctx: WorkspaceContext }) {
  const { lines, status, clear } = ctx.logs;
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const running = runningCount(lines);

  useEffect(() => {
    const element = list.current;
    if (follow && element && lines.length > 0) element.scrollTop = element.scrollHeight;
  }, [lines, follow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0d10]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
          <div className="flex items-center gap-2 font-mono text-xs text-gray-400">
            <span
              className={`size-2 rounded-full ${
                status === "live"
                  ? "bg-emerald-400"
                  : status === "idle"
                    ? "bg-gray-600"
                    : "animate-pulse bg-amber-400"
              }`}
            />
            {STATUS_LABEL[status]}
            {running > 0 ? <span className="text-gray-500">· {running} running</span> : null}
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              label={follow ? "Stop following new lines" : "Follow new lines"}
              icon={ArrowDownToLine}
              size="sm"
              pressed={follow}
              onClick={() => setFollow(!follow)}
            />
            <IconButton
              label="Clear the log"
              icon={Eraser}
              size="sm"
              disabled={lines.length === 0}
              onClick={clear}
            />
          </div>
        </header>
        <div
          ref={list}
          role="log"
          aria-label={`Calls on ${ctx.targetLabel}`}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-5"
          onScroll={(event) => {
            const element = event.currentTarget;
            const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            if (bottom !== follow) setFollow(bottom);
          }}
        >
          {lines.length === 0 ? (
            <div className="max-w-prose space-y-2 font-sans text-sm text-gray-500">
              <p>
                Calls agents make on {ctx.targetLabel} show up here as they run, the way{" "}
                <code className="font-mono text-gray-400">exeora connect</code> prints them on the
                machine, with the command or path each one is about.
              </p>
              <p>
                Only this tab sees them, and nothing is kept: close it and these lines are gone.
                What ran, without its arguments, is in{" "}
                <Link to="/activity" className="text-gray-400 underline">
                  Activity
                </Link>
                .
              </p>
            </div>
          ) : (
            lines.map((line) => <LogRow key={line.key} line={line} />)
          )}
        </div>
      </section>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  const time = <span className="shrink-0 text-gray-600 tabular-nums">{formatClock(line.at)}</span>;
  if (line.kind === "note") {
    return (
      <div className="flex gap-3 text-gray-500 italic">
        {time}
        <span>{line.text}</span>
      </div>
    );
  }
  if (line.kind === "start") {
    return (
      <div className="flex gap-3">
        {time}
        <span className="min-w-0 break-words whitespace-pre-wrap">
          <span className="text-sky-400">→ </span>
          <span className="text-gray-100">{line.mcp ? `MCP ${line.tool}` : line.tool}</span>
          {line.summary ? <span className="text-gray-300"> {line.summary}</span> : null}
          {line.client ? <span className="text-gray-600"> · {line.client}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      {time}
      <span className="min-w-0 break-words whitespace-pre-wrap">
        <span className={line.ok ? "text-emerald-400" : "text-red-400"}>
          {line.ok ? "✓ " : "✗ "}
        </span>
        <span className="text-gray-400">{line.tool}</span>
        <span className="text-gray-500 tabular-nums"> {formatDuration(line.durationMs)}</span>
        {line.errorCode ? <span className="text-red-400"> {line.errorCode}</span> : null}
      </span>
    </div>
  );
}
