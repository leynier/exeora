import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type CloudMachine, type CloudProject, cloudApi } from "../api-cloud.js";
import { AddCloudProjectDialog } from "../components/AddCloudProjectDialog.js";
import { AddCloudWorkspaceDialog } from "../components/AddCloudWorkspaceDialog.js";
import { CloudProjectCard } from "../components/CloudProjectCard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SetCloudCredentialDialog } from "../components/SetCloudCredentialDialog.js";
import { useToast } from "../components/toast.js";
import { Card, EmptyState, ErrorBanner, PageHeader, SkeletonRows } from "../components/ui.js";
import { keys, useCloudProjects, useMe } from "../queries.js";

/**
 * Repositories on machines Exeora runs.
 *
 * One card per repository, one row per machine, and every action answers
 * before it is done: the rows carry the state and the list polls until it
 * settles. Removing is the only thing that needs a second look, because a
 * machine is the only copy of whatever was never pushed from it.
 */
type Pending =
  | { kind: "project"; project: CloudProject }
  | { kind: "workspace"; project: CloudProject; machine: CloudMachine }
  | null;

export function Cloud() {
  const me = useMe();
  const projects = useCloudProjects();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState<CloudProject | null>(null);
  const [credentialFor, setCredentialFor] = useState<CloudProject | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.cloudProjects });
    queryClient.invalidateQueries({ queryKey: keys.projects });
    queryClient.invalidateQueries({ queryKey: keys.devices });
    queryClient.invalidateQueries({ queryKey: keys.me });
  };
  const fail = (error: unknown, fallback: string) => {
    toast(error instanceof Error ? error.message : fallback, "error");
    setPending(null);
  };

  const createProject = useMutation({
    mutationFn: cloudApi.createProject,
    onSuccess: (_result, input) => {
      toast(`Creating a machine for ${input.name}.`);
      setAdding(false);
      invalidate();
    },
    onError: (error) => fail(error, "Could not add the repository."),
  });

  const createWorkspace = useMutation({
    mutationFn: (input: { projectId: string; branch: string; from?: string }) =>
      cloudApi.createWorkspace(input.projectId, {
        branch: input.branch,
        ...(input.from ? { from: input.from } : {}),
      }),
    onSuccess: (_result, input) => {
      toast(`Creating a machine for ${input.branch}.`);
      setAddingWorkspace(null);
      invalidate();
    },
    onError: (error) => fail(error, "Could not add the workspace."),
  });

  const removeProject = useMutation({
    mutationFn: (project: CloudProject) => cloudApi.removeProject(project.projectId),
    onSuccess: (_result, project) => {
      toast(`Removing ${project.name}.`);
      setPending(null);
      invalidate();
    },
    onError: (error) => fail(error, "Could not remove the repository."),
  });

  const removeWorkspace = useMutation({
    mutationFn: (input: { project: CloudProject; machine: CloudMachine }) =>
      cloudApi.removeWorkspace(input.project.projectId, input.machine.workspaceId ?? ""),
    onSuccess: (_result, input) => {
      toast(`Removing ${input.machine.workspaceSlug}.`);
      setPending(null);
      invalidate();
    },
    onError: (error) => fail(error, "Could not remove the workspace."),
  });

  const setCredential = useMutation({
    mutationFn: (input: { projectId: string; token: string | null; username?: string }) =>
      cloudApi.setCredential(input.projectId, input.token, input.username),
    onSuccess: (_result, input) => {
      toast(
        input.token
          ? "Token saved. Retry a failed machine to clone with it."
          : "Token removed. New machines clone without one.",
      );
      setCredentialFor(null);
      invalidate();
    },
    onError: (error) => fail(error, "Could not save the token."),
  });

  const retry = useMutation({
    mutationFn: (machine: CloudMachine) => cloudApi.retryMachine(machine.deviceId),
    onSuccess: (_result, machine) => {
      toast(`Provisioning ${machine.workspaceSlug} again.`);
      invalidate();
    },
    onError: (error) => fail(error, "Could not retry."),
  });

  const busy =
    createProject.isPending ||
    createWorkspace.isPending ||
    removeProject.isPending ||
    removeWorkspace.isPending ||
    setCredential.isPending ||
    retry.isPending;

  if (me.isError) {
    return <PageHeader title="Cloud" subtitle="Account data is temporarily unavailable." />;
  }

  const user = me.data;
  const list = projects.data ?? [];
  const canProvision = user?.cloudEnabled === true;
  // Switched off with nothing to show: what Cloud is and who opens it. With
  // machines to show, they stay in view so they can be taken down.
  if (user && !canProvision && !projects.isLoading && list.length === 0) {
    return (
      <>
        <PageHeader title="Cloud" subtitle="Repositories on machines Exeora runs." />
        <Card>
          <EmptyState title="Exeora Cloud is not enabled for this account">
            Cloud clones a repository onto a machine Exeora runs and connects the CLI there, so an
            agent can work on it without a machine of your own. Ask an administrator to enable it.
          </EmptyState>
        </Card>
      </>
    );
  }

  const cap = user?.limits.maxCloudMachines ?? null;
  const used = user?.usage.cloudMachines ?? 0;
  const full = cap !== null && used >= cap;

  return (
    <>
      <PageHeader
        title="Cloud"
        subtitle={
          cap === null
            ? "Repositories on machines Exeora runs. Each workspace is its own machine."
            : `Repositories on machines Exeora runs. ${used} of ${cap} machines in use.`
        }
        action={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || full || !canProvision}
            onClick={() => setAdding(true)}
          >
            Add repository
          </button>
        }
      />

      {user && !canProvision && (
        <p className="text-body-md text-foreground-muted border-border bg-surface mb-6 rounded-xl border px-5 py-4">
          Exeora Cloud is switched off for this account. The machines below keep running and can be
          removed; ask an administrator to enable Cloud again to add or retry any.
        </p>
      )}

      {projects.isError ? (
        <ErrorBanner error={projects.error} onRetry={() => projects.refetch()} />
      ) : projects.isLoading || !user ? (
        <Card>
          <SkeletonRows />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState title="No repositories yet">
            Add one by URL. A machine is created for its default branch, and more for any branch you
            open as a workspace.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-6">
          {list.map((project) => (
            <CloudProjectCard
              key={project.projectId}
              project={project}
              busy={busy}
              full={full}
              canProvision={canProvision}
              onAddWorkspace={() => setAddingWorkspace(project)}
              onSetCredential={() => setCredentialFor(project)}
              onRemoveProject={() => setPending({ kind: "project", project })}
              onRemoveWorkspace={(machine) => setPending({ kind: "workspace", project, machine })}
              onRetry={(machine) => retry.mutate(machine)}
            />
          ))}
        </div>
      )}

      <AddCloudProjectDialog
        open={adding}
        pending={createProject.isPending}
        onCancel={() => setAdding(false)}
        onSubmit={(input) => createProject.mutate(input)}
      />

      <AddCloudWorkspaceDialog
        open={addingWorkspace !== null}
        pending={createWorkspace.isPending}
        defaultBranch={addingWorkspace?.defaultBranch ?? "main"}
        onCancel={() => setAddingWorkspace(null)}
        onSubmit={(input) => {
          if (!addingWorkspace) return;
          createWorkspace.mutate({ projectId: addingWorkspace.projectId, ...input });
        }}
      />

      <SetCloudCredentialDialog
        open={credentialFor !== null}
        pending={setCredential.isPending}
        projectName={credentialFor?.name ?? ""}
        hasCredential={credentialFor?.hasCredential ?? false}
        onCancel={() => setCredentialFor(null)}
        onSubmit={(input) => {
          if (!credentialFor) return;
          setCredential.mutate({ projectId: credentialFor.projectId, ...input });
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "project"
            ? `Remove ${pending.project.name}?`
            : `Remove ${pending?.machine.workspaceSlug ?? ""}?`
        }
        body={
          pending?.kind === "project"
            ? `Every machine of this repository is destroyed, ${pending.project.machines.length === 1 ? "the one" : `all ${pending.project.machines.length}`} of them, with whatever was never pushed from them. The repository itself is untouched, and its activity history goes with the project.`
            : "The machine is destroyed with whatever was never pushed from it. The branch stays on the remote if it was ever pushed."
        }
        confirmLabel={pending?.kind === "project" ? "Remove repository" : "Remove workspace"}
        pending={removeProject.isPending || removeWorkspace.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === "project") removeProject.mutate(pending.project);
          else removeWorkspace.mutate({ project: pending.project, machine: pending.machine });
        }}
      />
    </>
  );
}
