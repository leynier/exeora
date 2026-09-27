import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Project, ProjectLocation } from "../api.js";
import { type LocationGroup, type WorkspaceEntry, workspaceHref } from "../projectModel.js";
import { InstanceRow } from "./InstanceRow.js";
import { MachineFailure } from "./MachineFailure.js";
import { Fact, MachineRow } from "./MachineRow.js";
import { Menu, type MenuItem } from "./Menu.js";
import { StateBadge } from "./StateBadge.js";
import { Badge, Divided } from "./ui.js";
import type { InstanceControls } from "./WorkspaceControls.js";

/**
 * What a location has to say for itself when its state is not self-evident:
 * the cause, and what to do about it.
 */
export function locationNotice(location: ProjectLocation, entries: number): ReactNode {
  if (location.state === "removed") {
    return "This machine was revoked, so nothing here answers calls. Remove this location.";
  }
  if (location.state === "no instance") {
    return "Exeora Cloud holds no instance for the project root. The next call to it makes one, which takes about a minute, and so does Start instance.";
  }
  if (location.kind === "cloud") {
    return location.deviceId === null && entries === 0
      ? "Nothing is running here. Add a workspace to start an instance."
      : null;
  }
  if (location.status === "error") {
    return (
      <MachineFailure
        machine={location}
        fallback={`The repository could not be cloned on ${location.name}.`}
      />
    );
  }
  if (location.status === "cloning") {
    return "The repository is being cloned here. That can take a few minutes.";
  }
  if (location.status === "pending") {
    return location.state === "offline"
      ? `The repository is cloned here when the first workspace is made. ${location.name} is offline: run \`exeora connect\` on it first.`
      : "The repository is cloned here when the first workspace is made.";
  }
  if (location.state === "offline") {
    return `${location.name} is not connected. Run \`exeora connect\` on it to bring it back.`;
  }
  return null;
}

/** What starts the instance for the project root, where Exeora Cloud holds none. */
export interface StartInstance {
  pending: boolean;
  /** Why it cannot be asked for right now, as the cause and what to do. */
  blocked: string | null;
  onStart: () => void;
}

/**
 * One location of a project, with the workspaces it holds.
 *
 * The header is the location: its state, its name, whether calls land here.
 * Under it, the project root where this location has a copy of it, then every
 * workspace. An instance of Exeora Cloud is drawn by the same row the Machines
 * page uses, so it is the same thing in both places.
 */
export function LocationBlock({
  project,
  group,
  menu,
  busy,
  controls,
  start,
}: {
  project: Project;
  group: LocationGroup;
  menu: readonly MenuItem[];
  busy: boolean;
  controls: InstanceControls;
  /** Set while the location is in `no instance`, and only then. */
  start?: StartInstance | undefined;
}) {
  const { location, entries } = group;
  const notice = locationNotice(location, entries.length);

  return (
    <section aria-label={location.name} className="border-border-subtle border-t first:border-t-0">
      <header className="bg-surface-variant/40 flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StateBadge state={location.state} />
          <h3 className="text-title-md truncate">{location.name}</h3>
          {location.default && <Badge tone="brand">default location</Badge>}
          {location.localPath ? (
            <details className="min-w-0">
              <summary className="text-body-md text-foreground-faint hover:text-foreground">
                Path
              </summary>
              <code className="text-body-md text-foreground-muted font-mono break-all">
                {location.localPath}
              </code>
            </details>
          ) : null}
        </div>
        <Menu label={`Actions for ${location.name}`} items={menu} disabled={busy} />
      </header>

      {notice ? (
        <div className="text-body-md text-foreground-muted border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 last:border-b-0">
          <div className="min-w-0 flex-1">
            {notice}
            {start?.blocked ? <p className="mt-1">{start.blocked}</p> : null}
          </div>
          {start ? (
            <button
              type="button"
              className="btn btn-primary shrink-0"
              disabled={busy || start.blocked !== null}
              onClick={start.onStart}
            >
              {start.pending ? "Working…" : "Start instance"}
            </button>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <Divided>
          {entries.map((entry) => (
            <EntryRow
              key={entry.key}
              project={project}
              location={location}
              entry={entry}
              controls={controls}
            />
          ))}
        </Divided>
      ) : null}
    </section>
  );
}

function EntryRow({
  project,
  location,
  entry,
  controls,
}: {
  project: Project;
  location: ProjectLocation;
  entry: WorkspaceEntry;
  controls: InstanceControls;
}) {
  if (entry.instance) {
    return <InstanceRow instance={entry.instance} lens="project" controls={controls} />;
  }

  const workspaceId = entry.workspaceId;
  return (
    <MachineRow
      state={entry.state}
      title={<span className="font-mono">{entry.branch ?? entry.label}</span>}
      badges={entry.root ? <Badge>default branch</Badge> : null}
      meta={entry.root ? null : entry.slug}
      menuLabel={`Actions for ${entry.label}`}
      busy={controls.busy}
      actions={
        entry.openable ? (
          <Link to={workspaceHref(project.id, entry.slug)} className="btn">
            Open workspace
          </Link>
        ) : null
      }
      menu={
        workspaceId === null
          ? []
          : [
              {
                label: "Remove workspace",
                danger: true,
                onSelect: () =>
                  controls.removeWorkspace({
                    projectId: project.id,
                    workspaceId,
                    label: entry.label,
                    cloud: location.kind === "cloud",
                    where: location.name,
                    localPath: entry.localPath,
                  }),
              },
            ]
      }
      // The root's path is the location's, which the header above already has.
      detailsLabel="Path"
      details={
        !entry.root && entry.localPath ? (
          <dl>
            <Fact label="On this machine">{entry.localPath}</Fact>
          </dl>
        ) : undefined
      }
    />
  );
}
