import { Link } from "react-router";
import { relativeTime } from "../api.js";
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
import { formatDate } from "../format.js";
import { useAdminUsers } from "../queries.js";

/**
 * Every account on this gateway.
 *
 * A row is a door into that person's machines, projects, clients and activity,
 * which is why this list is a screen of its own rather than a card on Overview.
 */
export function AdminUsers() {
  const users = useAdminUsers();
  const list = users.data ?? [];

  if (users.isError) {
    return (
      <>
        <PageHeader title="Users" />
        <ErrorBanner
          error={users.error}
          title="Could not load users"
          onRetry={() => {
            void users.refetch();
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Every signed-up account, with the machines and projects hanging off each one."
      />

      <Card>
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
                      className="text-title-md hover:text-accent block truncate"
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
