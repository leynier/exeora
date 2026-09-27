import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { api, errorText, type Project } from "../api.js";
import { cloudApi } from "../api-cloud.js";
import type { CloudInstance, Machine } from "../api-projects.js";
import { cloudLocation, instanceLabel, instancesOf, livesOnlyOnCloud } from "../projectModel.js";
import { refreshPlaces, useMe } from "../queries.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import type { MenuItem } from "./Menu.js";
import { RemoveProjectDialog } from "./RemoveProjectDialog.js";
import { RemoveWorkspaceDialog, type WorkspaceRemoval } from "./RemoveWorkspaceDialog.js";
import { SetCloudCredentialDialog } from "./SetCloudCredentialDialog.js";
import { useToast } from "./toast.js";

/** What a row can ask for. The same object serves both lenses. */
export interface InstanceControls {
  busy: boolean;
  /** Whether the account may start instances. Removing one needs no permission. */
  canProvision: boolean;
  /** The root opens only where a call that names no workspace lands. */
  canOpen: (instance: CloudInstance) => boolean;
  /** Null for a project connected to GitHub, which clones without a token of its own. */
  credentialLabel: (instance: CloudInstance) => string | null;
  setCredential: (instance: CloudInstance) => void;
  setProjectCredential: (project: Project) => void;
  retry: (instance: CloudInstance) => void;
  removalItems: (instance: CloudInstance, lens: "project" | "machines") => MenuItem[];
  removeWorkspace: (target: WorkspaceRemoval) => void;
  removeProject: (project: Project) => void;
  /** The dialogs behind all of the above, rendered once by the page. */
  dialogs: ReactNode;
}

/**
 * Everything that can be done to an instance or a workspace, with the dialogs
 * that confirm it.
 *
 * One hook for the project page and the Machines page, which is what keeps
 * them from drifting: an instance is retried, given a token and removed by the
 * same code and behind the same words on both, because there is only this.
 */
export function useWorkspaceControls(input: {
  projects: readonly Project[];
  machines: readonly Machine[];
  /** How many workspaces the project on screen has, for the page that knows. */
  workspaceCount?: number;
  onProjectRemoved?: () => void;
}): InstanceControls {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removal, setRemoval] = useState<WorkspaceRemoval | null>(null);
  const [destroying, setDestroying] = useState<CloudInstance | null>(null);
  const [removingProject, setRemovingProject] = useState<Project | null>(null);
  const [credentialFor, setCredentialFor] = useState<Project | null>(null);

  const projectOf = (instance: CloudInstance) =>
    input.projects.find((project) => project.id === instance.project.id);
  const failedOf = (project: Project | null) =>
    project
      ? instancesOf(input.machines, project.id).filter((instance) => instance.state === "failed")
      : [];

  const retry = useMutation({
    mutationFn: (instance: CloudInstance) => cloudApi.retryMachine(instance.deviceId),
    onSuccess: (_result, instance) => {
      toast(`Setting up ${instanceLabel(instance)} again.`);
      void refreshPlaces(queryClient, instance.project.id);
    },
    onError: (error) => toast(errorText(error, "The instance could not be retried."), "error"),
  });

  const destroy = useMutation({
    mutationFn: (instance: CloudInstance) => api.revokeDevice(instance.deviceId),
    onSuccess: (_result, instance) => {
      toast(`Destroying the instance for ${instanceLabel(instance)}.`);
      setDestroying(null);
      void refreshPlaces(queryClient, instance.project.id);
    },
    onError: (error) => {
      toast(errorText(error, "The instance could not be destroyed."), "error");
      setDestroying(null);
    },
  });

  const credential = useMutation({
    // Saving a token is almost always the answer to an instance that could not
    // clone, so the ones that failed are retried with it in the same step
    // rather than left for somebody to find the button.
    mutationFn: async (entry: {
      project: Project;
      token: string | null;
      username?: string;
      retry: string[];
    }) => {
      await cloudApi.setCredential(entry.project.id, entry.token, entry.username);
      const retried = await Promise.allSettled(
        (entry.token ? entry.retry : []).map((deviceId) => cloudApi.retryMachine(deviceId)),
      );
      return retried.filter((result) => result.status === "fulfilled").length;
    },
    onSuccess: (retried, entry) => {
      toast(
        entry.token
          ? retried > 0
            ? "Token saved. Trying the failed instance again."
            : "Token saved."
          : "Token removed. New instances clone without one.",
      );
      setCredentialFor(null);
      void refreshPlaces(queryClient, entry.project.id);
    },
    onError: (error) => {
      toast(errorText(error, "The token could not be saved."), "error");
      setCredentialFor(null);
    },
  });

  const credentialLabel = (project: Project | undefined) =>
    !project || project.github
      ? null
      : project.cloud?.hasCredential
        ? "Replace token"
        : "Set token";

  return {
    busy: retry.isPending || destroy.isPending || credential.isPending,
    canProvision: me.data?.cloudEnabled === true,
    canOpen: (instance) => {
      if (instance.workspace.id !== null) return true;
      const project = projectOf(instance);
      return project ? cloudLocation(project)?.default === true : false;
    },
    credentialLabel: (instance) => credentialLabel(projectOf(instance)),
    setCredential: (instance) => setCredentialFor(projectOf(instance) ?? null),
    setProjectCredential: setCredentialFor,
    retry: (instance) => retry.mutate(instance),
    removalItems: (instance, lens) => {
      const workspaceId = instance.workspace.id;
      if (workspaceId !== null) {
        return [
          {
            label: lens === "machines" ? "Destroy" : "Remove workspace",
            danger: true,
            onSelect: () =>
              setRemoval({
                projectId: instance.project.id,
                workspaceId,
                label: instanceLabel(instance),
                cloud: true,
                where: "Exeora Cloud",
              }),
          },
        ];
      }
      // Under its project the root goes with the location or with the
      // project, and both of those have a removal of their own there.
      if (lens === "project") return [];
      return [
        {
          label: "Destroy",
          danger: true,
          onSelect: () => {
            const project = projectOf(instance);
            // The instance that carries a project living only on Cloud takes
            // the project with it, so it is asked for as what it is.
            if (project && livesOnlyOnCloud(project)) setRemovingProject(project);
            else setDestroying(instance);
          },
        },
      ];
    },
    removeWorkspace: setRemoval,
    removeProject: setRemovingProject,
    dialogs: (
      <>
        <RemoveWorkspaceDialog target={removal} onClose={() => setRemoval(null)} />
        <RemoveProjectDialog
          project={removingProject}
          machines={input.machines}
          workspaceCount={input.workspaceCount}
          onClose={() => setRemovingProject(null)}
          onRemoved={input.onProjectRemoved}
        />
        <ConfirmDialog
          open={destroying !== null}
          title={`Destroy the instance for ${destroying ? instanceLabel(destroying) : ""}?`}
          body={`This is the copy of ${destroying?.project.name ?? "the project"} that Exeora Cloud runs. Anything on it that was not pushed is lost, because the instance is the only copy of that. The project keeps its other locations, and the repository is untouched.`}
          confirmLabel="Destroy instance"
          pending={destroy.isPending}
          onCancel={() => setDestroying(null)}
          onConfirm={() => destroying && destroy.mutate(destroying)}
        />
        <SetCloudCredentialDialog
          open={credentialFor !== null}
          pending={credential.isPending}
          projectName={credentialFor?.name ?? ""}
          hasCredential={credentialFor?.cloud?.hasCredential ?? false}
          failed={failedOf(credentialFor).length}
          onCancel={() => setCredentialFor(null)}
          onSubmit={(entry) => {
            if (!credentialFor) return;
            credential.mutate({
              project: credentialFor,
              ...entry,
              retry: failedOf(credentialFor).map((instance) => instance.deviceId),
            });
          }}
        />
      </>
    ),
  };
}
