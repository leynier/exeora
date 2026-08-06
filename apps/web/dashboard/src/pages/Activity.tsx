import { useMemo, useState } from "react";
import { relativeTime } from "../api.js";
import {
  Badge,
  Card,
  Divided,
  EmptyState,
  PageHeader,
  Row,
  SkeletonRows,
} from "../components/ui.js";
import { formatDuration } from "../format.js";
import { useProjects, useToolCalls } from "../queries.js";

/**
 * The audit log.
 *
 * It records that a tool ran, how it ended and who asked, and deliberately
 * never records the arguments or the output, so this page can be shown to
 * someone without leaking the contents of a repository.
 *
 * Filtering happens in the browser: the API returns the most recent two
 * hundred rows in one request, which is both less work than paginating and
 * instant to narrow.
 */
export function Activity() {
  const calls = useToolCalls();
  const projects = useProjects();

  const [project, setProject] = useState("all");
  const [status, setStatus] = useState("all");
  const [client, setClient] = useState("all");

  const rows = useMemo(() => calls.data ?? [], [calls.data]);

  const clients = useMemo(
    () => [...new Set(rows.map((call) => call.clientId).filter((id) => id !== null))],
    [rows],
  );

  const filtered = rows.filter(
    (call) =>
      (project === "all" || call.projectId === project) &&
      (status === "all" || call.status === status) &&
      (client === "all" || call.clientId === client),
  );

  const nameFor = (projectId: string) =>
    projects.data?.find((candidate) => candidate.id === projectId)?.name ?? "removed project";

  const select =
    "border-border bg-surface text-body-md text-foreground-muted rounded-lg border px-2.5 py-1.5";

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="What ran and how it ended. Never the arguments, never the output."
      />

      <Card
        title={`${filtered.length} of ${rows.length} calls`}
        action={
          <div className="flex flex-wrap gap-2">
            <label>
              <span className="sr-only">Filter by project</span>
              <select
                className={select}
                value={project}
                onChange={(event) => setProject(event.target.value)}
              >
                <option value="all">All projects</option>
                {projects.data?.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="sr-only">Filter by outcome</span>
              <select
                className={select}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">Any outcome</option>
                <option value="ok">Succeeded</option>
                <option value="error">Failed</option>
              </select>
            </label>

            {clients.length > 1 && (
              <label>
                <span className="sr-only">Filter by client</span>
                <select
                  className={select}
                  value={client}
                  onChange={(event) => setClient(event.target.value)}
                >
                  <option value="all">Any client</option>
                  {clients.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        }
      >
        {calls.isLoading ? (
          <SkeletonRows count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState title={rows.length === 0 ? "Nothing yet" : "Nothing matches those filters"}>
            {rows.length === 0
              ? "Tool calls appear here as soon as an agent makes one."
              : "Widen them to see more."}
          </EmptyState>
        ) : (
          <Divided>
            {filtered.map((call) => (
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
                      {call.clientId ? ` · ${call.clientId}` : ""}
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
      </Card>
    </>
  );
}
