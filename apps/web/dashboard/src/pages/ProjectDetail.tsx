import { Link, useNavigate, useParams } from "react-router";
import { relativeTime } from "../api.js";
import { ClientList } from "../components/ClientList.js";
import { CommandPolicyCard } from "../components/CommandPolicyCard.js";
import { McpEndpoint } from "../components/McpEndpoint.js";
import { Menu } from "../components/Menu.js";
import { ProjectLocations } from "../components/ProjectLocations.js";
import { RepositoryLine } from "../components/RepositoryLine.js";
import {
  Badge,
  Card,
  Divided,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Row,
  Skeleton,
  SkeletonRows,
} from "../components/ui.js";
import { useWorkspaceControls } from "../components/WorkspaceControls.js";
import { formatDate, formatDuration } from "../format.js";
import { defaultBranchOf, workspaceHref } from "../projectModel.js";
import {
  useClients,
  useMachines,
  useMe,
  useProjects,
  useToolCalls,
  useWorkspaces,
} from "../queries.js";
import { callPlaceLabel } from "../selectors.js";

/**
 * One project: where it lives, how a client reaches it, who may, what they
 * may do, and what has been happening.
 *
 * This is the home of a project. Its locations, its workspaces and its own
 * removal are acted on here and nowhere else; every other page that shows
 * them links here.
 */
export function ProjectDetail() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const projects = useProjects();
  const machines = useMachines();
  const clients = useClients();
  // Narrowed by the server, so this is the project's most recent calls rather
  // than whichever of them happen to fall inside the account's most recent.
  const calls = useToolCalls(projectId ? { projectId } : {});
  const workspaces = useWorkspaces(projectId);

  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const controls = useWorkspaceControls({
    projects: projects.data ?? [],
    machines: machines.data ?? [],
    workspaceCount: workspaces.data?.length,
    onProjectRemoved: () => navigate("/projects"),
  });

  // The shell shows the failure and the way to retry it. What must not happen
  // here is a list that failed to load being read as a project that is gone.
  if (projects.isError) {
    return <PageHeader title="Project" subtitle="Project data is temporarily unavailable." />;
  }

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

  const authorized = (clients.data ?? []).filter((client) => client.projectId === project.id);
  const history = calls.data ?? [];
  const branch = defaultBranchOf(project);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-headline-md">{project.name}</h1>
            {project.github?.lostAccess && <Badge tone="error">lost access</Badge>}
          </div>
          <p className="text-body-md text-foreground-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <RepositoryLine project={project} />
            {branch ? (
              <span>
                default branch <span className="font-mono">{branch}</span>
              </span>
            ) : null}
            <span className="text-foreground-faint">added {formatDate(project.createdAt)}</span>
          </p>
          {project.github?.lostAccess ? (
            <p className="text-body-md text-error mt-2">
              Exeora can no longer read {project.github.fullName} on GitHub, so Exeora Cloud cannot
              fetch or push.{" "}
              <Link to="/settings" className="underline">
                Give it the repository again in Settings
              </Link>
              .
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to={workspaceHref(project.id, null)} className="btn btn-primary">
            Open workspace
          </Link>
          <Menu
            label={`Actions for ${project.name}`}
            items={[
              {
                label: "Remove project",
                danger: true,
                onSelect: () => controls.removeProject(project),
              },
            ]}
          />
        </div>
      </header>

      {workspaces.isError ? (
        <ErrorBanner
          error={workspaces.error}
          title="Could not load the workspaces"
          onRetry={() => void workspaces.refetch()}
        />
      ) : null}
      {machines.isError ? (
        <ErrorBanner
          error={machines.error}
          title="Could not load the state of the instances"
          onRetry={() => void machines.refetch()}
        />
      ) : null}

      {workspaces.isLoading ? (
        <Card title="Locations and workspaces">
          <SkeletonRows />
        </Card>
      ) : (
        <ProjectLocations
          project={project}
          workspaces={workspaces.data ?? []}
          machines={machines.data ?? []}
          user={me.data}
          controls={controls}
        />
      )}

      <div className="mt-6">
        <Card
          title="Connect a client"
          subtitle="This URL reaches this project and has no way to name another."
        >
          <div className="p-5">
            <McpEndpoint url={project.mcpUrl} />
          </div>
        </Card>
      </div>

      {/* Reading down the page, the endpoint is followed by who is allowed to
          call it, and then by what they may do. */}
      <div className="mt-6">
        <Card title="Clients with access">
          {clients.isError ? (
            <EmptyState title="Could not load the clients">
              The list of clients is temporarily unavailable.
            </EmptyState>
          ) : (
            <ClientList clients={authorized} />
          )}
        </Card>
      </div>

      <div className="mt-6">
        <CommandPolicyCard project={project} />
      </div>

      <div className="mt-6">
        <Card
          title="Recent activity"
          action={
            <Link
              to="/activity"
              className="text-body-md text-foreground-faint hover:text-foreground"
            >
              All
            </Link>
          }
        >
          {calls.isError ? (
            <EmptyState title="The activity log is unavailable">
              Calls are still running and still being recorded. Try again in a moment.
            </EmptyState>
          ) : history.length === 0 ? (
            <EmptyState title="Nothing yet">
              Calls made against this project appear here.
            </EmptyState>
          ) : (
            <Divided>
              {history.slice(0, 20).map((call) => (
                <Row key={call.id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge tone={call.status === "ok" ? "success" : "error"}>{call.status}</Badge>
                    <code className="text-body-md truncate font-mono">{call.tool}</code>
                    <span className="text-body-md text-foreground-faint truncate font-mono">
                      {callPlaceLabel(call.workspaceSlug, project, workspaces.data)}
                    </span>
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

      {controls.dialogs}
    </>
  );
}
