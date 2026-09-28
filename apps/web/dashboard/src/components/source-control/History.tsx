import { IconButton } from "@exeora/design/react";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { relativeTime } from "../../api.js";
import type { GitCommit } from "../../api-types-workspace.js";
import { type Target, useGitLog } from "../../queries-workspace.js";
import { ErrorBanner, Skeleton } from "../ui.js";
import { commitGraph, parseRef } from "./commitGraph.js";
import { HistoryGraph, ROW_HEIGHT } from "./HistoryGraph.js";

/**
 * The commits behind HEAD, newest first, a page at a time, with the graph of
 * how they join. Opening one shows what it changed.
 */
export function History({
  target,
  open,
  selectedOid,
  onOpen,
}: {
  target: Target;
  open: boolean;
  selectedOid: string | null;
  onOpen: (commit: GitCommit) => void;
}) {
  const log = useGitLog(target, open);
  const commits = useMemo(() => log.data?.pages.flatMap((page) => page.commits) ?? [], [log.data]);
  const rows = useMemo(() => commitGraph(commits), [commits]);
  const maxWidth = rows.reduce((max, row) => Math.max(max, row.width), 1);

  if (!open) return null;

  return (
    <section aria-label="Commits" className="flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <h2 className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
          Commits{" "}
          <span className="tabular-nums">
            {commits.length}
            {log.hasNextPage ? "+" : ""}
          </span>
        </h2>
        <IconButton
          label="Refresh commits"
          icon={RefreshCw}
          size="sm"
          busy={log.isFetching}
          onClick={() => void log.refetch()}
        />
      </header>
      {log.isError ? (
        <div className="px-3">
          <ErrorBanner error={log.error} onRetry={() => void log.refetch()} />
        </div>
      ) : log.isLoading ? (
        <div className="space-y-2 px-3 py-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-48" />
        </div>
      ) : commits.length === 0 ? (
        <p className="text-body-md text-foreground-faint px-3 py-2">No commits yet.</p>
      ) : (
        <ul className="min-h-0 overflow-y-auto">
          {commits.map((commit, index) => {
            const row = rows[index];
            const active = commit.oid === selectedOid;
            return (
              <li key={commit.oid}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  style={{ height: ROW_HEIGHT }}
                  className={`flex w-full items-center gap-2 pr-2 pl-1 text-left ${
                    active ? "bg-accent-subtle" : "hover:bg-surface-variant"
                  }`}
                  onClick={() => onOpen(commit)}
                >
                  {row ? <HistoryGraph row={row} maxWidth={maxWidth} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="text-body-md text-foreground min-w-0 truncate">
                        {commit.subject}
                      </span>
                      {commit.refs.map((ref) => {
                        const parsed = parseRef(ref);
                        return (
                          <span
                            key={ref}
                            className={`text-label-md shrink-0 rounded px-1 font-mono ${
                              parsed.kind === "head"
                                ? "bg-brand-subtle text-brand"
                                : parsed.kind === "tag"
                                  ? "bg-warning/15 text-warning"
                                  : "bg-surface-elevated text-foreground-muted"
                            }`}
                          >
                            {parsed.name}
                          </span>
                        );
                      })}
                    </span>
                    <span className="text-label-md text-foreground-faint flex min-w-0 gap-2 font-mono">
                      <span>{commit.shortOid}</span>
                      <span className="truncate">{commit.authorName}</span>
                      <span className="shrink-0">
                        {relativeTime(Date.parse(commit.authoredAt))}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {log.hasNextPage ? (
            <li className="px-3 py-2">
              <button
                type="button"
                className="btn w-full"
                disabled={log.isFetchingNextPage}
                onClick={() => void log.fetchNextPage()}
              >
                {log.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
