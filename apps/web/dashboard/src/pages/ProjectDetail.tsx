import { Link, useParams } from "react-router";
import { isOnline, relativeTime } from "../api.js";
import { ClientList } from "../components/ClientList.js";
import { CopyButton } from "../components/CopyButton.js";
import {
  Badge,
  Card,
  Divided,
  EmptyState,
  PageHeader,
  Row,
  Skeleton,
  StatusDot,
} from "../components/ui.js";
import { formatDate, formatDuration } from "../format.js";
import { useClients, useDevices, useProjects, useToolCalls } from "../queries.js";

/**
 * One project: where to point a client, which machine serves it, and what has
 * been happening on it.
 */
export function ProjectDetail() {
  const { projectId } = useParams();
  const projects = useProjects();
  const devices = useDevices();
  const clients = useClients();
  const calls = useToolCalls();

  const project = projects.data?.find((candidate) => candidate.id === projectId);

  if (projects.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (!project) {
    return (
      <>
        <PageHeader title="Project not found" />
        <div className="border-border bg-surface rounded-xl border">
          <EmptyState title="That project is gone">
            It may have been removed.{" "}
            <Link to="/projects" className="underline">
              See all projects
            </Link>
            .
          </EmptyState>
        </div>
      </>
    );
  }

  const device = devices.data?.find((candidate) => candidate.id === project.deviceId);
  const authorized = (clients.data ?? []).filter((client) => client.projectId === project.id);
  const history = (calls.data ?? []).filter((call) => call.projectId === project.id);

  const claudeCode = `claude mcp add --transport http exeora ${project.mcpUrl}`;

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`Added ${formatDate(project.createdAt)}.`}
        action={
          <Link to="/projects" className="btn">
            All projects
          </Link>
        }
      />

      <Card title="MCP endpoint">
        <div className="p-5">
          <div className="border-border bg-bg flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <code className="text-body-md text-foreground min-w-0 flex-1 truncate font-mono">
              {project.mcpUrl}
            </code>
            <CopyButton value={project.mcpUrl} label="Copy" />
          </div>

          <p className="text-body-md text-foreground-muted mt-5">
            Paste it into any MCP client that speaks Streamable HTTP, or add it from a terminal:
          </p>

          <div className="border-border bg-bg mt-2.5 flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <code className="text-body-md text-foreground-muted min-w-0 flex-1 truncate font-mono">
              {claudeCode}
            </code>
            <CopyButton value={claudeCode} label="Copy" />
          </div>
        </div>
      </Card>

      {/* Full width, and above the machine: reading down the page, the endpoint
          is followed by who is allowed to call it. */}
      <div className="mt-6">
        <Card title="Clients with access">
          <ClientList clients={authorized} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* `self-start` so it keeps its own height instead of stretching to
            match however long the activity list happens to be. */}
        <Card title="Machine" className="self-start">
          <div className="space-y-3 p-5">
            <div className="flex items-center gap-3">
              <StatusDot
                on={device ? isOnline(device) : false}
                label={device && isOnline(device) ? "online" : "offline"}
              />
              <div className="min-w-0">
                <p className="text-title-md truncate">{device?.name ?? "unknown machine"}</p>
                <p className="text-body-md text-foreground-faint">
                  {device
                    ? device.revokedAt
                      ? "revoked"
                      : isOnline(device)
                        ? "online"
                        : `last seen ${relativeTime(device.lastSeenAt)}`
                    : "no longer registered"}
                </p>
              </div>
            </div>

            {/* Stacked rather than two columns: a local path is long enough
                that side by side leaves it truncated to nothing useful. */}
            <dl className="text-body-md border-border-subtle space-y-3 border-t pt-3">
              <div>
                <dt className="text-label-md text-foreground-faint font-mono uppercase">
                  Local path
                </dt>
                <dd className="mt-0.5 font-mono break-all">{project.localPath}</dd>
              </div>
              <div>
                <dt className="text-label-md text-foreground-faint font-mono uppercase">Slug</dt>
                <dd className="mt-0.5 font-mono">{project.slug}</dd>
              </div>
            </dl>
          </div>
        </Card>

        <Card title="Activity on this project">
          {history.length === 0 ? (
            <EmptyState title="Nothing yet">
              Calls made against this endpoint appear here.
            </EmptyState>
          ) : (
            <Divided>
              {history.slice(0, 20).map((call) => (
                <Row key={call.id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge tone={call.status === "ok" ? "success" : "error"}>{call.status}</Badge>
                    <code className="text-body-md truncate font-mono">{call.tool}</code>
                    {call.errorCode && (
                      <span className="text-body-md text-error truncate">{call.errorCode}</span>
                    )}
                  </div>
                  <p className="text-body-md text-foreground-faint shrink-0 tabular-nums">
                    {formatDuration(call.durationMs)} · {relativeTime(call.createdAt)}
                  </p>
                </Row>
              ))}
            </Divided>
          )}
        </Card>
      </div>
    </>
  );
}
