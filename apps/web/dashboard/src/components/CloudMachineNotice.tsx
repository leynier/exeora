import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { cloudApi } from "../api-cloud.js";
import { keys, useCloudProjects } from "../queries.js";
import { useToast } from "./toast.js";
import { EmptyState } from "./ui.js";

/**
 * What the Workspace tab shows instead of "machine offline" for a cloud
 * workspace: the machine is being built, failed, or is on its way out, and
 * each of those is a different thing to tell someone. A ready machine that
 * is merely asleep never reaches here for long, since the capabilities poll
 * wakes it.
 */
export function CloudMachineNotice({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string | null;
}) {
  const projects = useCloudProjects();
  const queryClient = useQueryClient();
  const toast = useToast();
  const machine = projects.data
    ?.find((project) => project.projectId === projectId)
    ?.machines.find((candidate) => candidate.workspaceId === workspaceId);

  const retry = useMutation({
    mutationFn: cloudApi.retryMachine,
    onSuccess: () => {
      toast("Provisioning again.");
      queryClient.invalidateQueries({ queryKey: keys.cloudProjects });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "Could not retry.", "error"),
  });

  const cloudLink = (
    <Link to="/cloud" className="underline">
      Cloud
    </Link>
  );

  if (!machine) {
    return (
      <EmptyState title="Waking the machine">
        The first call after a pause takes a moment. This view refreshes on its own; the machine's
        state is under {cloudLink}.
      </EmptyState>
    );
  }

  if (machine.status === "creating") {
    return (
      <EmptyState title="Setting up this workspace">
        {machine.step ?? "Starting"}… This view opens on its own once the CLI connects.
      </EmptyState>
    );
  }

  if (machine.status === "error") {
    return (
      <EmptyState title="This machine failed to start">
        <p className="text-error">{machine.error ?? "Provisioning failed."}</p>
        <button
          type="button"
          className="btn mt-4"
          disabled={retry.isPending}
          onClick={() => retry.mutate(machine.deviceId)}
        >
          {retry.isPending ? "Working…" : "Retry"}
        </button>
      </EmptyState>
    );
  }

  if (machine.status === "destroying") {
    return (
      <EmptyState title="This workspace is being removed">
        The machine is on its way out. Its row disappears from {cloudLink} when it is gone.
      </EmptyState>
    );
  }

  return (
    <EmptyState title="Waking the machine">
      It sleeps when idle and takes a moment to answer the first call. This view refreshes on its
      own.
    </EmptyState>
  );
}
