import { useMemo, useState } from "react";
import { relativeTime } from "../api.js";
import { Select } from "../components/Select.js";
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
   * Labelled by name but filtered by id, because two clients can register the
   * same name and picking one of them should not quietly select both.
   */
  const clientOptions = useMemo(() => {
    const named = new Map<string, string>();
    for (const call of rows) {
      if (call.clientId) named.set(call.clientId, call.clientName ?? "Unnamed client");
    }

    return [
      { value: "all", label: "Any client" },
      ...[...named].map(([value, label]) => ({ value, label })),
    ];
  }, [rows]);

  const filtered = rows.filter(
    (call) =>
      (project === "all" || call.projectId === project) &&
      (status === "all" || call.status === status) &&
      (client === "all" || call.clientId === client),
  );

  const nameFor = (projectId: string) =>
    projects.data?.find((candidate) => candidate.id === projectId)?.name ?? "removed project";

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
      </Card>
    </>
  );
}
