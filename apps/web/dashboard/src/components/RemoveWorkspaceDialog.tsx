import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorText } from "../api.js";
import { projectsApi } from "../api-projects.js";
import { keys, refreshPlaces } from "../queries.js";
import { Dialog, DialogActions, DialogError } from "./Dialog.js";
import { useToast } from "./toast.js";

/** A workspace that is about to go, with what the confirmation has to say about it. */
export interface WorkspaceRemoval {
  projectId: string;
  workspaceId: string;
  /** The branch, which is what the person knows it by. */
  label: string;
  /** Whether it is an instance of Exeora Cloud rather than a working copy on a machine. */
  cloud: boolean;
  /** The name of the location it is in. */
  where: string;
  localPath?: string | null;
}

/**
 * The one way a workspace is removed, wherever it was asked for.
 *
 * It says what is destroyed before anything is, and the first request is
 * always the careful one: the machine refuses when there is work that would be
 * lost, the refusal is shown as it came, and only then is going ahead anyway
 * on offer. Forcing is never the first button.
 */
export function RemoveWorkspaceDialog({
  target,
  onClose,
}: {
  target: WorkspaceRemoval | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: (entry: { target: WorkspaceRemoval; force: boolean }) =>
      projectsApi.removeWorkspace(entry.target.projectId, entry.target.workspaceId, entry.force),
    onSuccess: (result, entry) => {
      toast(
        result.status === "removing"
          ? `Removing ${entry.target.label}. Its instance is being destroyed.`
          : `${entry.target.label} was removed from ${entry.target.where}.`,
      );
      void refreshPlaces(queryClient, entry.target.projectId);
      void queryClient.invalidateQueries({ queryKey: keys.allCalls });
      close();
    },
  });

  const close = () => {
    remove.reset();
    onClose();
  };

  // Only a refusal that forcing answers is offered the way around it. A
  // machine that is simply off is a failure, and forcing would not help.
  const refused =
    remove.error instanceof ApiError &&
    remove.error.status === 422 &&
    remove.error.body?.unforced === true;

  return (
    <Dialog
      open={target !== null}
      title={`Remove workspace ${target?.label ?? ""}?`}
      // Escape must not abandon a removal that is already on its way.
      onCancel={() => {
        if (!remove.isPending) close();
      }}
    >
      {target ? (
        <>
          <p className="text-body-md text-foreground-muted mt-2">This destroys:</p>
          <ul className="text-body-md text-foreground-muted mt-1 list-disc space-y-1 pl-5">
            {target.cloud ? (
              <>
                <li>The instance on Exeora Cloud that runs {target.label}.</li>
                <li>Anything on it that was not pushed. The instance is the only copy of that.</li>
              </>
            ) : (
              <>
                <li>
                  The working copy of {target.label} on {target.where}
                  {target.localPath ? (
                    <>
                      , at <code className="font-mono break-all">{target.localPath}</code>
                    </>
                  ) : null}
                  .
                </li>
              </>
            )}
          </ul>
          <p className="text-body-md text-foreground-muted mt-3">
            The branch stays in the repository, and so does everything that was pushed. A working
            copy with changes that were never committed is not removed without asking again.
          </p>

          <DialogError>
            {remove.isError ? errorText(remove.error, "The workspace could not be removed.") : null}
          </DialogError>

          <DialogActions>
            <button type="button" className="btn" onClick={close} disabled={remove.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ target, force: refused })}
            >
              {remove.isPending ? "Working…" : refused ? "Remove anyway" : "Remove workspace"}
            </button>
          </DialogActions>
        </>
      ) : null}
    </Dialog>
  );
}
