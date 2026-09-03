import { useMemo, useState } from "react";
import { relativeTime, type ToolCallFilters } from "../api.js";
import { Select } from "../components/Select.js";
import {
  Badge,
  Card,
  Divided,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Row,
  SkeletonRows,
} from "../components/ui.js";
import { formatDuration } from "../format.js";
import { useClients, useProjects, useToolCallPages } from "../queries.js";

/** The only filter whose choices are known ahead of the data. */
const statusOptions = [
  { value: "all", label: "Any outcome" },
  { value: "ok", label: "Succeeded" },
  { value: "error", label: "Failed" },
];

/**
 * The audit log.
 *
 * It records that a tool ran, how it ended and who asked, and deliberately
 * never records the arguments or the output, so this page can be shown to
 * someone without leaking the contents of a repository.
 *
 * Filtering is the server's job. Narrowing the page in hand was cheaper, but it
 * quietly meant "the most recent fifty": a filter that found nothing looked the
 * same whether there were no matches or whether every match was just off the
 * end of what had been fetched.
 */
export function Activity() {
  const projects = useProjects();
  const clients = useClients();

  const [project, setProject] = useState("all");
  const [status, setStatus] = useState("all");
  const [client, setClient] = useState("all");

  const filters = useMemo<ToolCallFilters>(
    () => ({
      ...(project === "all" ? {} : { projectId: project }),
      ...(status === "ok" || status === "error" ? { status } : {}),
      ...(client === "all" ? {} : { clientId: client }),
    }),
    [project, status, client],
  );

  const calls = useToolCallPages(filters);
  const rows = useMemo(() => (calls.data?.pages ?? []).flatMap((page) => page.items), [calls.data]);

  const projectOptions = useMemo(
    () => [
      { value: "all", label: "All projects" },
      ...(projects.data ?? []).map((candidate) => ({
        value: candidate.id,
        label: candidate.name,
      })),
    ],
    [projects.data],
  );

  /**
   * Built from the authorized clients rather than from the rows on screen.
   *
   * Deriving it from the rows made sense when they were the whole log; with
   * pages it would offer only the clients that happen to appear in the ones
   * already loaded, so filtering to a quiet client would be impossible exactly
   * when it is most useful.
   *
   * Labelled by name but filtered by id, because two clients can register the
   * same name and picking one of them should not quietly select both.
   */
  const clientOptions = useMemo(() => {
    const named = new Map<string, string>();
    for (const authorized of clients.data ?? []) {
      named.set(
        authorized.clientId,
        authorized.clientName ?? authorized.mcpName ?? "Unnamed client",
      );
    }

    return [
      { value: "all", label: "Any client" },
      ...[...named].map(([value, label]) => ({ value, label })),
    ];
  }, [clients.data]);

  const nameFor = (projectId: string) =>
    projects.data?.find((candidate) => candidate.id === projectId)?.name ?? "removed project";

  const filtering = project !== "all" || status !== "all" || client !== "all";

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="What ran and how it ended. Never the arguments, never the output."
      />

      {calls.isError && (
        <ErrorBanner
          error={calls.error}
          title="Could not load activity"
          onRetry={() => {
            void calls.refetch();
          }}
        />
      )}

      <Card
        // Counts what has been loaded, not what exists: the server never sends
        // a total, and inventing one from the pages in hand would be a number
        // that changes as you scroll.
        title={calls.hasNextPage ? `${rows.length} calls so far` : `${rows.length} calls`}
        action={
          <div className="flex flex-wrap gap-2">
            <Select
              label="Filter by project"
              value={project}
              options={projectOptions}
              onChange={setProject}
            />

            <Select
              label="Filter by outcome"
              value={status}
              options={statusOptions}
              onChange={setStatus}
            />

            {clientOptions.length > 2 && (
              <Select
                label="Filter by client"
                value={client}
                options={clientOptions}
                onChange={setClient}
              />
            )}
          </div>
        }
      >
        {calls.isError ? null : calls.isLoading ? (
          <SkeletonRows count={5} />
        ) : rows.length === 0 ? (
          <EmptyState title={filtering ? "Nothing matches those filters" : "Nothing yet"}>
            {filtering
              ? "Widen them to see more. This searched the whole log, not just the page on screen."
              : "Tool calls appear here a few minutes after an agent makes one."}
          </EmptyState>
        ) : (
          <Divided>
            {rows.map((call) => (
              <Row key={call.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <Badge tone={call.status === "ok" ? "success" : "error"}>{call.status}</Badge>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-body-md truncate font-mono">{call.tool}</code>
                      {call.errorCode && (
                        <span className="text-body-md text-error truncate">{call.errorCode}</span>
                      )}
                    </div>
                    <p className="text-body-md text-foreground-faint truncate">
                      {nameFor(call.projectId)}
                      {call.workspaceSlug ? ` / ${call.workspaceSlug}` : " / main"}
                      {call.clientName ? ` · ${call.clientName}` : ""}
                    </p>
                  </div>
                </div>

                <p className="text-body-md text-foreground-faint shrink-0 tabular-nums">
                  {formatDuration(call.durationMs)} · {relativeTime(call.createdAt)}
                </p>
              </Row>
            ))}
          </Divided>
        )}

        {calls.hasNextPage && (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              className="btn"
              disabled={calls.isFetchingNextPage}
              onClick={() => calls.fetchNextPage()}
            >
              {calls.isFetchingNextPage ? "Loading" : "Load more"}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
