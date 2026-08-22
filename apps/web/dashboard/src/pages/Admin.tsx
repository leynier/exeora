import { Link } from "react-router";
import { Card, ErrorBanner, PageHeader, Stat } from "../components/ui.js";
import { useAdminOverview } from "../queries.js";

/**
 * Cross-account administration, at a glance.
 *
 * Only people on the fixed email allow-list ever reach this screen. The server
 * is the real gate; the route guard is only so ordinary accounts never see an
 * empty shell. The user list is a destination of its own, because the rail
 * inside Admin is a set of screens rather than one page with everything on it.
 */
export function Admin() {
  const overview = useAdminOverview();
  const totals = overview.data;

  if (overview.isError) {
    return (
      <>
        <PageHeader title="Administration" />
        <ErrorBanner
          error={overview.error}
          title="Could not load administration data"
          onRetry={() => {
            void overview.refetch();
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Every account on this gateway, and the machines and projects hanging off each one."
        action={
          <Link to="/admin/users" className="btn">
            Users
          </Link>
        }
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

      <Card title="Accounts" className="mt-6">
        <div className="px-5 py-5">
          <p className="text-body-md text-foreground-muted">
            Open Users to inspect an account: its machines, projects, clients and recent tool calls,
            and to revoke or delete from there.
          </p>
          <Link to="/admin/users" className="btn mt-4">
            Open users
          </Link>
        </div>
      </Card>
    </>
  );
}
