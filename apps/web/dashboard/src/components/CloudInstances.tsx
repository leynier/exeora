import { Link, useSearchParams } from "react-router";
import type { User } from "../api.js";
import type { CloudInstance } from "../api-projects.js";
import { STATES } from "../states.js";
import { InstanceRow } from "./InstanceRow.js";
import { Select } from "./Select.js";
import { Card, Divided, EmptyState, SkeletonRows } from "./ui.js";
import type { InstanceControls } from "./WorkspaceControls.js";

/** The states an instance can be in: the vocabulary without the ones only a location has. */
const INSTANCE_STATES = STATES.filter(
  (state) => state !== "not cloned" && state !== "no instance" && state !== "removed",
);

/**
 * Every instance Exeora Cloud runs for the account, whichever project it
 * belongs to.
 *
 * The filters live in the address, so a link from the overview can land on
 * the instances that failed and a reload keeps what was being looked at.
 */
export function CloudInstances({
  instances,
  user,
  loading,
  controls,
}: {
  instances: readonly CloudInstance[];
  user: User | undefined;
  loading: boolean;
  controls: InstanceControls;
}) {
  const [search, setSearch] = useSearchParams();
  const project = search.get("project") ?? "all";
  const state = search.get("state") ?? "all";

  const setFilter = (name: "project" | "state", value: string) => {
    const params = new URLSearchParams(search);
    if (value === "all") params.delete(name);
    else params.set(name, value);
    setSearch(params, { replace: true });
  };

  // Switched off with nothing to show: what Exeora Cloud is and who opens it.
  // With instances to show, they stay in view so they can be destroyed.
  if (user && !user.cloudEnabled && !loading && instances.length === 0) {
    return (
      <Card>
        <EmptyState title="Exeora Cloud is not enabled for this account">
          Exeora Cloud clones a project onto an instance Exeora runs and connects the CLI there, so
          an agent can work on it with no machine of yours switched on. An administrator enables it
          for an account.
        </EmptyState>
      </Card>
    );
  }

  const projects = [
    ...new Map(instances.map((instance) => [instance.project.id, instance.project.name])),
  ];
  const shown = instances.filter(
    (instance) =>
      (project === "all" || instance.project.id === project) &&
      (state === "all" || instance.state === state),
  );

  return (
    <>
      {user && <Usage used={user.usage.cloudMachines} max={user.limits.maxCloudMachines} />}

      {user && !user.cloudEnabled && (
        <p className="text-body-md text-foreground-muted border-border bg-surface mb-6 rounded-xl border px-5 py-4">
          Exeora Cloud is switched off for this account. The instances below keep running and can be
          destroyed. An administrator enables it again before any can be added or retried.
        </p>
      )}

      <Card
        title={`${shown.length} ${shown.length === 1 ? "instance" : "instances"}`}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Select
              label="Filter by project"
              value={project}
              options={[
                { value: "all", label: "All projects" },
                ...projects.map(([value, label]) => ({ value, label })),
              ]}
              onChange={(value) => setFilter("project", value)}
            />
            <Select
              label="Filter by state"
              value={state}
              options={[
                { value: "all", label: "Any state" },
                ...INSTANCE_STATES.map((value) => ({ value, label: value })),
              ]}
              onChange={(value) => setFilter("state", value)}
            />
          </div>
        }
      >
        {loading ? (
          <SkeletonRows />
        ) : instances.length === 0 ? (
          <EmptyState title="No instance is running">
            An instance starts when a project is put on Exeora Cloud, and one more for every
            workspace added there.{" "}
            <Link to="/projects?add=1" className="underline">
              Add project
            </Link>
            .
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="No instance matches those filters">
            Widen them to see the others.
          </EmptyState>
        ) : (
          <Divided>
            {shown.map((instance) => (
              <InstanceRow
                key={instance.deviceId}
                instance={instance}
                lens="machines"
                controls={controls}
              />
            ))}
          </Divided>
        )}
      </Card>
    </>
  );
}

/** How much of the plan's room for instances is taken, as a bar and as a sentence. */
function Usage({ used, max }: { used: number; max: number | null }) {
  const label =
    max === null
      ? `${used} ${used === 1 ? "instance" : "instances"}, with no limit`
      : `${used} of ${max} instances`;
  const share = max === null || max === 0 ? 0 : Math.min(used / max, 1);
  const full = max !== null && used >= max;

  return (
    <div className="border-border bg-surface mb-6 rounded-xl border px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-title-md tabular-nums">{label}</p>
        {full && (
          <p className="text-body-md text-foreground-muted">
            The limit is reached. Destroy an instance to make room for another.
          </p>
        )}
      </div>
      {max !== null && (
        <div
          role="progressbar"
          aria-label="Instances in use"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.min(used, max)}
          aria-valuetext={label}
          className="bg-surface-variant mt-3 h-1.5 overflow-hidden rounded-full"
        >
          <div
            className={`h-full rounded-full ${full ? "bg-error" : "bg-brand"}`}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
