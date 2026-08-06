import { ClientList } from "../components/ClientList.js";
import { Card, EmptyState, PageHeader, SkeletonRows } from "../components/ui.js";
import { useClients, useProjects } from "../queries.js";

/**
 * Every AI client that has been let into a project, across all of them.
 *
 * The list is per project rather than per application on purpose: a token here
 * is bound to one endpoint, so "Claude has access" is never the whole answer,
 * and the same client authorized against two projects is two decisions to make
 * separately.
 */
export function Clients() {
  const clients = useClients();
  const projects = useProjects();

  const rows = clients.data ?? [];
  const nameOf = (projectId: string) =>
    projects.data?.find((project) => project.id === projectId)?.name ?? "removed project";

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="The AI clients you have authorized, and what each of them can still reach."
      />

      <Card title={rows.length === 0 ? undefined : `${rows.length} authorized`}>
        {clients.isLoading ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyState title="No clients yet">
            Add a project's MCP URL to Claude, ChatGPT or Cursor and approve it. It shows up here
            once you do.
          </EmptyState>
        ) : (
          <ClientList clients={rows} projectNameOf={nameOf} />
        )}
      </Card>
    </>
  );
}
