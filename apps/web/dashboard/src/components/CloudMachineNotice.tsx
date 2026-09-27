import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { errorText } from "../api.js";
import { cloudApi } from "../api-cloud.js";
import { instancesOf } from "../projectModel.js";
import { refreshPlaces, useMachines } from "../queries.js";
import { MachineFailure, needsToken } from "./MachineFailure.js";
import { useToast } from "./toast.js";
import { EmptyState } from "./ui.js";

/**
 * What the Workspace tab shows instead of "machine offline" for a workspace on
 * Exeora Cloud: the instance is being set up, failed, or is on its way out,
 * and each of those is a different thing to tell someone. An instance that is
 * merely asleep never reaches here for long, since the capabilities poll
 * wakes it.
 */
export function CloudMachineNotice({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string | null;
}) {
  const machines = useMachines();
  const queryClient = useQueryClient();
  const toast = useToast();
  const instance = instancesOf(machines.data ?? [], projectId).find(
    (candidate) => candidate.workspace.id === workspaceId,
  );

  const retry = useMutation({
    mutationFn: cloudApi.retryMachine,
    onSuccess: () => {
      toast("Setting it up again.");
      void refreshPlaces(queryClient, projectId);
    },
    onError: (error) => toast(errorText(error, "The instance could not be retried."), "error"),
  });

  const machinesLink = (
    <Link to="/machines?view=cloud" className="underline">
      Machines
    </Link>
  );

  if (!instance) {
    return (
      <EmptyState title="Waking the instance">
        The first call after a pause takes a moment. This view refreshes on its own; the state of
        the instance is under {machinesLink}.
      </EmptyState>
    );
  }

  if (instance.state === "setting up") {
    return (
      <EmptyState title="Setting up this workspace">
        {instance.step ?? "Starting"}… This view opens on its own once the instance is ready.
      </EmptyState>
    );
  }

  if (instance.state === "failed") {
    return (
      <EmptyState title="This instance failed to start">
        <MachineFailure machine={instance} />
        {needsToken(instance) && (
          <p className="text-body-md text-foreground-muted mt-2">
            Set the token from the{" "}
            <Link to={`/projects/${projectId}`} className="underline">
              project
            </Link>
            , under Exeora Cloud. Saving it retries this instance.
          </p>
        )}
        <button
          type="button"
          className="btn mt-4"
          disabled={retry.isPending}
          onClick={() => retry.mutate(instance.deviceId)}
        >
          {retry.isPending ? "Working…" : "Retry"}
        </button>
      </EmptyState>
    );
  }

  if (instance.state === "removing") {
    return (
      <EmptyState title="This workspace is being removed">
        Its instance is on its way out. It leaves {machinesLink} when it is gone.
      </EmptyState>
    );
  }

  return (
    <EmptyState title="Waking the instance">
      It sleeps when idle and takes a moment to answer the first call. This view refreshes on its
      own.
    </EmptyState>
  );
}
