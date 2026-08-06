import { Link } from "react-router";
import { isOnline, relativeTime } from "../api.js";
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
  StatusDot,
} from "../components/ui.js";
import { formatDuration } from "../format.js";
import { useDevices, useProjects, useToolCalls } from "../queries.js";

/**
 * The state of things, at a glance.
 *
 * The numbers are derived in the browser from data the API already returns:
 * there is no stats endpoint, and inventing one to compute an average of two
 * hundred rows would be the wrong trade.
 */
export function Overview() {
  const devices = useDevices();
  const projects = useProjects();
  const calls = useToolCalls();

  const machines = devices.data ?? [];
  const online = machines.filter(isOnline);
  const recent = calls.data ?? [];
  const failed = recent.filter((call) => call.status === "error");

  const averageMs =
    recent.length > 0
      ? Math.round(recent.reduce((total, call) => total + call.durationMs, 0) / recent.length)
      : 0;

  if (!devices.isLoading && machines.length === 0) {
    return (
      <>
        <PageHeader title="Overview" subtitle="Nothing is connected yet." />
        <Onboarding />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          online.length > 0
            ? `${online.length} of ${machines.length} ${machines.length === 1 ? "machine" : "machines"} online.`
            : "No machine is connected right now."
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Online"
          value={`${online.length}`}
          hint={`of ${machines.length} registered`}
          loading={devices.isLoading}
        />
        <Stat
          label="Projects"
          value={`${projects.data?.length ?? 0}`}
          hint="each with its own MCP URL"
          loading={projects.isLoading}
        />
        <Stat
          label="Failed"
          value={
            recent.length === 0 ? "0" : `${Math.round((failed.length / recent.length) * 100)}%`
          }
          hint={`of the last ${recent.length} calls`}
          loading={calls.isLoading}
        />
        <Stat
          label="Average"
          value={recent.length === 0 ? "0ms" : formatDuration(averageMs)}
          hint="per tool call"
          loading={calls.isLoading}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card
          title="Machines"
          action={
            <Link
              to="/machines"
              className="text-body-md text-foreground-faint hover:text-foreground"
            >
              All
            </Link>
          }
        >
          {devices.isLoading ? (
            <SkeletonRows count={2} />
          ) : (
            <Divided>
              {machines.slice(0, 4).map((device) => (
                <Row key={device.id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusDot
                      on={isOnline(device)}
                      label={isOnline(device) ? "online" : "offline"}
                    />
                    <div className="min-w-0">
                      <p className="text-title-md truncate">{device.name}</p>
                      <p className="text-body-md text-foreground-faint truncate">
                        {device.revokedAt
                          ? "revoked"
                          : isOnline(device)
                            ? "online"
                            : `last seen ${relativeTime(device.lastSeenAt)}`}
                      </p>
                    </div>
                  </div>
                </Row>
              ))}
            </Divided>
          )}
        </Card>

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
          ) : recent.length === 0 ? (
            <EmptyState title="No tool calls yet">
              They appear here as soon as an agent uses one.
            </EmptyState>
          ) : (
            <Divided>
              {recent.slice(0, 4).map((call) => (
                <Row key={call.id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge tone={call.status === "ok" ? "success" : "error"}>{call.status}</Badge>
                    <code className="text-body-md truncate font-mono">{call.tool}</code>
                  </div>
                  <p className="text-body-md text-foreground-faint shrink-0">
                    {relativeTime(call.createdAt)}
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
