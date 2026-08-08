import { Link } from "react-router";
import { relativeTime } from "../api.js";
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
import { formatDate } from "../format.js";
import { useAdminOverview, useAdminUsers } from "../queries.js";

/**
 * Cross-account administration.
 *
 * Only people on the fixed email allow-list ever reach this screen. The server
 * is the real gate; the route guard is only so ordinary accounts never see an
 * empty shell.
 */
export function Admin() {
  const overview = useAdminOverview();
  const users = useAdminUsers();

  const totals = overview.data;
  const list = users.data ?? [];

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Every account on this gateway, and the machines and projects hanging off each one."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Users"
          value={`${totals?.users ?? 0}`}
          hint="signed-up accounts"
          loading={overview.isLoading}
        />
        <Stat
          label="Online"
          value={`${totals?.devicesOnline ?? 0}`}
          hint={`of ${totals?.devices ?? 0} machines`}
          loading={overview.isLoading}
        />
        <Stat
          label="Projects"
          value={`${totals?.projects ?? 0}`}
          hint={`${totals?.clients ?? 0} active clients`}
          loading={overview.isLoading}
        />
        <Stat
          label={
            totals?.usageWindow === "complete_utc_days" ? "Calls (last UTC day)" : "Calls (24h)"
          }
          value={`${totals?.toolCalls24h ?? 0}`}
          hint={
            totals
              ? `${Math.round(totals.errorRate7d * 100)}% errors over ${
                  totals.usageWindow === "complete_utc_days" ? "7 complete UTC days" : "7d"
                }`
              : "errors over 7d"
          }
          loading={overview.isLoading}
        />
      </div>

      <Card title="Users" className="mt-6">
        {users.isLoading ? (
          <SkeletonRows count={4} />
        ) : list.length === 0 ? (
          <EmptyState title="No users yet">Accounts appear here as people sign in.</EmptyState>
        ) : (
          <Divided>
            {list.map((user) => (
              <Row key={user.id}>
                <div className="flex min-w-0 items-center gap-3">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      width={32}
                      height={32}
                      className="border-border size-8 shrink-0 rounded-full border"
                    />
                  ) : (
                    <span className="bg-accent-subtle text-foreground-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                      {(user.name ?? user.email).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <Link
                      to={`/admin/users/${user.id}`}
                      className="text-title-md hover:text-accent truncate block"
                    >
                      {user.name ?? user.email}
                    </Link>
                    <p className="text-body-md text-foreground-faint truncate">
                      {user.name ? user.email : `joined ${formatDate(user.createdAt)}`}
                      {user.lastActivityAt
                        ? ` · active ${relativeTime(user.lastActivityAt)}`
                        : " · no activity yet"}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <Badge tone={user.devicesOnline > 0 ? "success" : "neutral"}>
                    {user.devicesOnline}/{user.devices} online
                  </Badge>
                  <Badge>
                    {user.projects} {user.projects === 1 ? "project" : "projects"}
                  </Badge>
                  <Badge>
                    {user.clients} {user.clients === 1 ? "client" : "clients"}
                  </Badge>
                  <Badge tone="brand">
                    {user.toolCalls} {user.toolCalls === 1 ? "call" : "calls"}
                  </Badge>
                </div>
              </Row>
            ))}
          </Divided>
        )}
      </Card>
    </>
  );
}
