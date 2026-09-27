import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  errorText,
  type Project,
  type ProjectLocation,
  type User,
  type Workspace,
} from "../api.js";
import { type Machine, projectsApi } from "../api-projects.js";
import { groupByLocation, type ProjectTree } from "../projectModel.js";
import { refreshPlaces } from "../queries.js";
import { removalBlocker } from "../survival.js";
import { AddLocationDialog } from "./AddLocationDialog.js";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { LocationBlock } from "./LocationBlock.js";
import { MachineRow } from "./MachineRow.js";
import type { MenuItem } from "./Menu.js";
import { useToast } from "./toast.js";
import { Card, Divided, EmptyState } from "./ui.js";
import type { InstanceControls } from "./WorkspaceControls.js";

/**
 * Where a project lives and what it holds there: the heart of its page.
 *
 * One block per location and, under each, the workspaces in it. Everything a
 * location or a workspace can have done to it starts here and nowhere else,
 * which is what lets the other pages show the same things as links.
 */
export function ProjectLocations({
  project,
  workspaces,
  machines,
  user,
  controls,
}: {
  project: Project;
  workspaces: readonly Workspace[];
  machines: readonly Machine[];
  user: User | undefined;
  controls: InstanceControls;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);
  const [removing, setRemoving] = useState<ProjectLocation | null>(null);
  const tree = groupByLocation(project, workspaces, machines);

  const makeDefault = useMutation({
    mutationFn: (location: ProjectLocation) =>
      projectsApi.setDefaultLocation(project.id, location.id),
    onSuccess: (_result, location) => {
      toast(
        location.kind === "cloud" && location.deviceId === null
          ? "Exeora Cloud is the default location now. An instance is being set up for the project."
          : `${location.name} is the default location now. Calls that name no workspace land there.`,
      );
      void refreshPlaces(queryClient, project.id);
    },
    onError: (error) => toast(errorText(error, "The default could not be changed."), "error"),
  });

  const removeLocation = useMutation({
    mutationFn: (location: ProjectLocation) => projectsApi.removeLocation(project.id, location.id),
    onSuccess: (_result, location) => {
      toast(
        location.kind === "cloud"
          ? `Taking ${project.name} off Exeora Cloud. Its instances are being destroyed.`
          : `${project.name} no longer lives on ${location.name}. The files there are untouched.`,
      );
      setRemoving(null);
      void refreshPlaces(queryClient, project.id);
    },
    onError: (error) => {
      toast(errorText(error, "The location could not be removed."), "error");
      setRemoving(null);
    },
  });

  const busy = makeDefault.isPending || removeLocation.isPending || controls.busy;

  const menuFor = (location: ProjectLocation): MenuItem[] => [
    ...(!location.default && location.state !== "removed"
      ? [{ label: "Make default", onSelect: () => makeDefault.mutate(location) }]
      : []),
    ...(location.kind === "cloud" && !project.github
      ? [
          {
            label: project.cloud?.hasCredential ? "Replace token" : "Set token",
            onSelect: () => controls.setProjectCredential(project),
          },
        ]
      : []),
    {
      label: "Remove location",
      danger: true,
      onSelect: () => {
        const blocker = removalBlocker(project, location);
        if (blocker) toast(blocker, "error");
        else setRemoving(location);
      },
    },
  ];

  return (
    <>
      <Card
        title="Locations and workspaces"
        subtitle="Where this project has a copy, and the branches that have a working copy of their own there."
        action={
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button type="button" className="btn" onClick={() => setAddingLocation(true)}>
              Add location
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAddingWorkspace(true)}
            >
              Add workspace
            </button>
          </div>
        }
      >
        {tree.groups.length === 0 ? (
          <EmptyState title="This project has no location">
            Add one to give it a place to live.
          </EmptyState>
        ) : (
          tree.groups.map((group) => (
            <LocationBlock
              key={group.location.id}
              project={project}
              group={group}
              menu={menuFor(group.location)}
              busy={busy}
              controls={controls}
            />
          ))
        )}
        <Unplaced project={project} tree={tree} controls={controls} />
      </Card>

      <AddWorkspaceDialog
        open={addingWorkspace}
        project={project}
        user={user}
        onCancel={() => setAddingWorkspace(false)}
        onCreated={() => setAddingWorkspace(false)}
      />

      <AddLocationDialog
        open={addingLocation}
        project={project}
        machines={machines}
        user={user}
        onClose={() => setAddingLocation(false)}
      />

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? ""} from ${project.name}?`}
        body={
          removing?.kind === "cloud"
            ? "The project is taken off Exeora Cloud and stays in its other locations. This destroys:"
            : "Exeora forgets that the project lives on this machine. This removes:"
        }
        details={removing ? <RemovalList location={removing} tree={tree} /> : null}
        confirmLabel="Remove location"
        pending={removeLocation.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && removeLocation.mutate(removing)}
      />
    </>
  );
}

/** What goes with a location, by name, so the confirmation is a list and not a promise. */
function RemovalList({ location, tree }: { location: ProjectLocation; tree: ProjectTree }) {
  const entries = tree.groups.find((group) => group.location.id === location.id)?.entries ?? [];
  const names = entries.map((entry) => entry.label);
  const list = "text-body-md text-foreground-muted mt-1 list-disc space-y-1 pl-5";

  if (location.kind === "cloud") {
    return (
      <ul className={list}>
        <li>
          {names.length === 0
            ? "No instance: none is running."
            : `${names.length === 1 ? "The instance" : `The ${names.length} instances`} for ${names.join(", ")}.`}
        </li>
        <li>Anything on them that was not pushed. An instance is the only copy of that.</li>
        <li>The token kept for cloning, when there is one.</li>
      </ul>
    );
  }

  const workspaces = entries.filter((entry) => !entry.root).map((entry) => entry.label);
  return (
    <ul className={list}>
      <li>The record of this location.</li>
      <li>
        {workspaces.length === 0
          ? "No workspace: there is none here."
          : `The record of ${workspaces.length === 1 ? "the workspace" : `the ${workspaces.length} workspaces`} ${workspaces.join(", ")}.`}
      </li>
      <li>
        Nothing on {location.name} itself. The folder and its working copies stay where they are, no
        longer served.
      </li>
    </ul>
  );
}

/**
 * Workspaces on a machine that is not a location of the project. There should
 * be none; one that exists is shown apart rather than under a location it is
 * not in, and can still be removed.
 */
function Unplaced({
  project,
  tree,
  controls,
}: {
  project: Project;
  tree: ProjectTree;
  controls: InstanceControls;
}) {
  if (tree.unplaced.length === 0) return null;
  return (
    <section
      aria-label="Workspaces in no location"
      className="border-border-subtle border-t first:border-t-0"
    >
      <header className="bg-surface-variant/40 px-5 py-3">
        <h3 className="text-title-md">In no location</h3>
        <p className="text-body-md text-foreground-faint mt-0.5">
          These are on a machine that is no longer a location of this project.
        </p>
      </header>
      <Divided>
        {tree.unplaced.map((entry) => (
          <MachineRow
            key={entry.key}
            title={<span className="font-mono">{entry.label}</span>}
            meta={entry.slug}
            menuLabel={`Actions for ${entry.label}`}
            busy={controls.busy}
            menu={
              entry.workspaceId === null
                ? []
                : [
                    {
                      label: "Remove workspace",
                      danger: true,
                      onSelect: () =>
                        controls.removeWorkspace({
                          projectId: project.id,
                          workspaceId: entry.workspaceId ?? "",
                          label: entry.label,
                          cloud: false,
                          where: "its machine",
                        }),
                    },
                  ]
            }
          />
        ))}
      </Divided>
    </section>
  );
}
