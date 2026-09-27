import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { AddLocationDialog } from "../components/AddLocationDialog.js";
import { AddProjectDialog } from "../components/AddProjectDialog.js";
import { McpEndpoint } from "../components/McpEndpoint.js";
import { MachineSteps } from "../components/Onboarding.js";
import { ProjectCard } from "../components/ProjectCard.js";
import { Card, EmptyState, PageHeader, Skeleton } from "../components/ui.js";
import { workspaceCount } from "../projectModel.js";
import { useAccountClients, useMachines, useMe, useProjects } from "../queries.js";
import { isLeaving } from "../survival.js";

/**
 * What the account has, and where each of those things lives.
 *
 * One of the two lenses over the same data: this one is by project, the
 * Machines page is by what is running. A row here is a way into the project,
 * so there is one place a project is changed or removed and it is the
 * project's page. The one thing a row offers is a location, to a project that
 * lives nowhere.
 */
export function Projects() {
  const projects = useProjects();
  const machines = useMachines();
  const me = useMe();
  const accountClients = useAccountClients();
  const [search, setSearch] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [showingMachine, setShowingMachine] = useState(false);
  // Kept by id, so the dialog reads the project as the list has it now.
  const [placing, setPlacing] = useState<string | null>(null);

  // Other pages send people here to add a project. The mark is taken out of
  // the address once it has been acted on, so a reload does not reopen it.
  const asked = search.get("add") === "1";
  useEffect(() => {
    if (!asked) return;
    setAdding(true);
    setSearch({}, { replace: true });
  }, [asked, setSearch]);

  const rows = projects.data ?? [];

  if (projects.isError || me.isError) {
    return <PageHeader title="Projects" subtitle="Project data is temporarily unavailable." />;
  }

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="A project is a repository. It lives in one or more locations: your machines, or Exeora Cloud."
        action={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add project
          </button>
        }
      />

      {/* First, because it is the one URL that keeps working as projects come
          and go: a client added once here never has to be reconfigured. */}
      {me.data && (
        <AccountEndpointCard
          url={me.data.accountMcpUrl}
          collapsed={(accountClients.data?.length ?? 0) > 0}
        />
      )}

      {projects.isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <>
          <div className="border-border bg-surface rounded-xl border">
            <EmptyState title="No projects yet">
              Put one on Exeora Cloud from here, or add one from a machine of your own.
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                  Add project
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-expanded={showingMachine}
                  onClick={() => setShowingMachine((shown) => !shown)}
                >
                  See how to use my machine
                </button>
              </div>
            </EmptyState>
          </div>
          {showingMachine && (
            <section className="border-border bg-surface mt-4 rounded-xl border p-6 sm:p-7">
              <h2 className="text-headline-sm">Use my machine</h2>
              <MachineSteps />
            </section>
          )}
        </>
      ) : (
        <div className="grid gap-4">
          {rows.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              workspaces={machines.data ? workspaceCount(machines.data, project.id) : null}
              leaving={isLeaving(project, machines.data ?? [])}
              onAddLocation={() => setPlacing(project.id)}
            />
          ))}
        </div>
      )}

      <AddProjectDialog open={adding} onClose={() => setAdding(false)} />
      <AddLocationDialog
        open={placing !== null}
        project={rows.find((project) => project.id === placing)}
        machines={machines.data ?? []}
        user={me.data}
        onClose={() => setPlacing(null)}
      />
    </>
  );
}

/**
 * The account URL, offered above the per-project ones.
 *
 * It says what it costs as well as what it gives, in the place where the choice
 * between the two is actually made. Once a client is connected through it the
 * card has done its job and is reference material, so it folds to one line and
 * leaves the room to the projects.
 */
function AccountEndpointCard({ url, collapsed }: { url: string; collapsed: boolean }) {
  const body = (
    <>
      <McpEndpoint url={url} />
      <p className="text-body-md text-foreground-muted mt-5">
        You choose which projects it reaches when you authorize it, and can change that from Clients
        afterwards. A project's own URL is narrower: a client on it can reach that project and has
        no way to name another.
      </p>
    </>
  );

  if (collapsed) {
    return (
      <details className="border-border bg-surface mb-6 rounded-xl border px-5 py-3.5">
        <summary className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-title-md text-foreground">One URL for everything</span>
          <span className="text-body-md text-foreground-faint">
            The account URL your clients are connected through.
          </span>
        </summary>
        <div className="pt-4 pb-1.5">{body}</div>
      </details>
    );
  }

  return (
    <Card
      title="One URL for everything"
      subtitle="Add it once. Each tool call names its project when there is more than one."
      className="mb-6"
    >
      <div className="p-5">{body}</div>
    </Card>
  );
}
