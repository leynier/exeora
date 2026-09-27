import { useSearchParams } from "react-router";
import { CloudInstances } from "../components/CloudInstances.js";
import { LocalMachines } from "../components/LocalMachines.js";
import { PageHeader } from "../components/ui.js";
import { useWorkspaceControls } from "../components/WorkspaceControls.js";
import { NavIcon } from "../layouts/Sidebar.js";
import { instancesOf, localMachines } from "../projectModel.js";
import { useMachines, useMe, useProjects } from "../queries.js";

const VIEWS = [
  { value: "own", label: "Your machines", icon: "machines" },
  { value: "cloud", label: "Exeora Cloud", icon: "cloud" },
] as const;

/**
 * Everything that is running, whichever project it belongs to.
 *
 * The other lens over the same data as Projects: that page answers what there
 * is and where it lives, this one answers what is running. The rows are the
 * same rows, so an instance met here is the one met on its project's page.
 *
 * This is the one page that asks the provider what each instance is doing,
 * which is why the list is fetched `live` here and nowhere else.
 */
export function Machines() {
  const [search, setSearch] = useSearchParams();
  const me = useMe();
  const machines = useMachines(true);
  const projects = useProjects();
  const view = search.get("view") === "cloud" ? "cloud" : "own";

  const controls = useWorkspaceControls({
    projects: projects.data ?? [],
    machines: machines.data ?? [],
  });

  if (machines.isError || projects.isError) {
    return <PageHeader title="Machines" subtitle="Machine data is temporarily unavailable." />;
  }

  const own = localMachines(machines.data ?? []);
  const instances = instancesOf(machines.data ?? []);

  return (
    <>
      <PageHeader
        title="Machines"
        subtitle="What is running: the machines you connected, and the instances Exeora Cloud runs for you."
      />

      <div role="tablist" aria-label="Machines" className="border-border mb-6 flex gap-1 border-b">
        {VIEWS.map((entry) => {
          const selected = view === entry.value;
          const count = entry.value === "cloud" ? instances.length : own.length;
          return (
            <button
              key={entry.value}
              type="button"
              role="tab"
              id={`machines-tab-${entry.value}`}
              aria-selected={selected}
              aria-controls="machines-panel"
              onClick={() =>
                // The filters belong to the tab they were set on.
                setSearch(entry.value === "cloud" ? { view: "cloud" } : {}, { replace: true })
              }
              className={`text-title-md flex items-center gap-2 border-b-2 px-4 py-2.5 ${
                selected
                  ? "border-brand text-foreground"
                  : "text-foreground-faint hover:text-foreground border-transparent"
              }`}
            >
              <NavIcon name={entry.icon} />
              {entry.label}
              {machines.data && (
                <span className="text-label-md text-foreground-faint font-mono tabular-nums">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div id="machines-panel" role="tabpanel" aria-labelledby={`machines-tab-${view}`}>
        {view === "cloud" ? (
          <CloudInstances
            instances={instances}
            user={me.data}
            loading={machines.isLoading}
            controls={controls}
          />
        ) : (
          <LocalMachines
            machines={own}
            projects={projects.data ?? []}
            loading={machines.isLoading}
          />
        )}
      </div>

      {controls.dialogs}
    </>
  );
}
