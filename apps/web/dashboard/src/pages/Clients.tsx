import { AccountClientList } from "../components/AccountClientList.js";
import { ClientList } from "../components/ClientList.js";
import { Card, EmptyState, ErrorBanner, PageHeader, SkeletonRows } from "../components/ui.js";
import { useAccountClients, useClients, useProjects } from "../queries.js";

/**
 * Every AI client that has been let in, across every project.
 *
 * Split by the URL it was authorized against, because the two grant different
 * things and are undone differently. A client on a project's own URL reaches
 * that project and nothing else, so it is one row per project and revoking one
 * says nothing about the others. A client on the account URL is one connection
 * covering the projects it was given, so it is one row with a list inside it.
 *
 * The same application can appear in both, and that is not a duplicate: they are
 * two separate consents, and taking one away leaves the other standing.
 */
export function Clients() {
  const clients = useClients();
  const accountClients = useAccountClients();
  const projects = useProjects();

  // Only per-project rows here; the account ones have a section of their own,
  // where a client is a connection rather than a project.
  const rows = (clients.data ?? []).filter((client) => client.endpoint === "project");
  const accountRows = accountClients.data ?? [];

  const nameOf = (projectId: string) =>
    projects.data?.find((project) => project.id === projectId)?.name ?? "removed project";

  if (clients.isError || projects.isError) {
    return <PageHeader title="Clients" subtitle="Authorization data is temporarily unavailable." />;
  }

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="The AI clients you have authorized, and what each of them can still reach."
      />

      {accountClients.isError && (
        <ErrorBanner
          error={accountClients.error}
          title="Could not load account clients"
          onRetry={() => {
            void accountClients.refetch();
          }}
        />
      )}

      <Card
        title="On the account URL"
        subtitle="One connection each, covering the projects you gave it."
      >
        {/* Both queries, because this list is drawn from the two together: the
            projects are the tick boxes and the names in the dropdown, so
            rendering before they land shows a connection with no projects to
            give it and every project it already has as "removed". */}
        {accountClients.isError ? null : accountClients.isLoading || projects.isLoading ? (
          <SkeletonRows />
        ) : accountRows.length === 0 ? (
          <EmptyState title="No clients on the account URL">
            Add the account MCP URL to a client and choose which projects it may reach. It shows up
            here once you do.
          </EmptyState>
        ) : (
          <AccountClientList clients={accountRows} projects={projects.data ?? []} />
        )}
      </Card>

      <div className="mt-6">
        <Card
          title="On a project's own URL"
          subtitle="One row per project, each authorized on its own."
        >
          {clients.isLoading ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <EmptyState title="No clients on a project URL">
              Add a project's MCP URL to Claude, ChatGPT or Cursor and approve it. It shows up here
              once you do.
            </EmptyState>
          ) : (
            <ClientList clients={rows} projectNameOf={nameOf} />
          )}
        </Card>
      </div>
    </>
  );
}
