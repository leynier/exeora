import { Link } from "react-router";
import { relativeTime } from "../api.js";
import { attentionItems } from "../attention.js";
import { NeedsAttention } from "../components/NeedsAttention.js";
import { Onboarding } from "../components/Onboarding.js";
import {
  Badge,
  Card,
  Divided,
  EmptyState,
  PageHeader,
  Row,
  SkeletonRows,
  Stat,
} from "../components/ui.js";
import { instancesOf, localMachines } from "../projectModel.js";
import {
  useAccountClients,
  useMachines,
  useMe,
  useProjects,
  useToolCalls,
  useWorkspacesOf,
} from "../queries.js";
import { callPlaceLabel, projectsToAsk } from "../selectors.js";
import { instanceExceptions, instanceSummary } from "../states.js";

/**
 * The state of things, at a glance, and what in it needs somebody.
 *
 * The numbers are derived in the browser from data the API already returns:
 * there is no stats endpoint, and inventing one to count a handful of rows
 * would be the wrong trade. Each of them is a link to the page that explains
 * it.
 */
export function Overview() {
  const me = useMe();
  const machines = useMachines();
  const projects = useProjects();
  const calls = useToolCalls();
  const accountClients = useAccountClients();

  const own = localMachines(machines.data ?? []).filter((machine) => machine.state !== "removed");
  const online = own.filter((machine) => machine.state === "online");
  const instances = instancesOf(machines.data ?? []);
  const recent = calls.data ?? [];
  const failed = recent.filter((call) => call.status === "error");
  const list = projects.data ?? [];
  // Where a call in a workspace ran is said by the workspace, so the ones of
  // the projects on screen are asked for, and of no others.
  const shown = recent.slice(0, 6);
  const workspaces = useWorkspacesOf(projectsToAsk(shown, list));

  // The activity log failing is not a reason to hide what is running: it is
  // kept in a warehouse of its own, and that can be down while every machine
  // is up. Its card and its number say so; the rest of the page stands.
  if (machines.isError || projects.isError) {
    return <PageHeader title="Overview" subtitle="Live account data is temporarily unavailable." />;
  }

  if (!projects.isLoading && list.length === 0) {
    return (
      <>
        <PageHeader
          title="Overview"
          subtitle="Nothing is here yet. There are two ways to add your first project."
        />
        <Onboarding />
      </>
    );
  }

  const showCloud = me.data?.cloudEnabled === true || instances.length > 0;
  const cap = me.data?.limits.maxCloudMachines ?? null;
  const states = instances.map((instance) => instance.state);

  return (
    <>
      <PageHeader title="Overview" subtitle="What you have, what is running, and what needs you." />

      <div
        className={`grid gap-4 sm:grid-cols-2 ${showCloud ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
      >
        <Stat
          label="Projects"
          value={`${list.length}`}
          hint="each with its own MCP URL"
          to="/projects"
          loading={projects.isLoading}
        />
        <Stat
          label="Machines online"
          value={`${online.length} of ${own.length}`}
          hint={own.length === 0 ? "none of your own connected" : "of your own"}
          to="/machines"
          loading={machines.isLoading}
        />
        {showCloud && (
          <Stat
            label="Cloud instances"
            value={instanceSummary(states)}
            hint={[
              cap === null ? `${instances.length} in all` : `${instances.length} of ${cap}`,
              instanceExceptions(states),
            ]
              .filter(Boolean)
              .join(" · ")}
            to="/machines?view=cloud"
            loading={machines.isLoading}
          />
        )}
        <Stat
          label="Failed calls"
          value={calls.isError ? "–" : `${failed.length}`}
          hint={calls.isError ? "the activity log is unavailable" : `of the last ${recent.length}`}
          to="/activity"
          loading={calls.isLoading}
        />
      </div>

      <div className="mt-6">
        <NeedsAttention
          loading={machines.isLoading || projects.isLoading}
          items={attentionItems({
            projects: list,
            machines: machines.data ?? [],
            accountClients: accountClients.data ?? [],
            latestCliVersion: me.data?.latestCliVersion,
          })}
        />
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
          {calls.isLoading ? (
            <SkeletonRows count={2} />
          ) : calls.isError ? (
            <EmptyState title="The activity log is unavailable">
              Calls are still running and still being recorded. Try again in a moment.
            </EmptyState>
          ) : recent.length === 0 ? (
            <EmptyState title="No tool calls yet">
              They appear here as soon as an agent uses one.
            </EmptyState>
          ) : (
            <Divided>
              {shown.map((call) => {
                const project = list.find((candidate) => candidate.id === call.projectId);
                return (
                  <Row key={call.id}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Badge tone={call.status === "ok" ? "success" : "error"}>{call.status}</Badge>
                      <code className="text-body-md truncate font-mono">{call.tool}</code>
                      <span className="text-body-md text-foreground-faint truncate">
                        {project?.name ?? "removed project"} /{" "}
                        {callPlaceLabel(
                          call.workspaceSlug,
                          project,
                          workspaces.get(call.projectId),
                        )}
                      </span>
                    </div>
                    <p className="text-body-md text-foreground-faint shrink-0">
                      {relativeTime(call.createdAt)}
                    </p>
                  </Row>
                );
              })}
            </Divided>
          )}
        </Card>
      </div>
    </>
  );
}
