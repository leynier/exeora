import { useQuery } from "@tanstack/react-query";
import { Check, CircleDashed, CircleX, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { prApi, prKeys } from "../../api-pr.js";
import { Dialog, DialogActions, DialogError } from "../Dialog.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { STEP_LABELS } from "./shipPlan.js";
import { useShip } from "./useShip.js";

/**
 * Ship changes, watched: the steps as they run, the branch and the titles
 * the assistant chose as they are chosen, and the pull request at the end.
 * Starts as soon as it opens; Stop halts before the next step.
 */
export function ShipDialog({
  ctx,
  open,
  onClose,
}: {
  ctx: WorkspaceContext;
  open: boolean;
  onClose: () => void;
}) {
  const ship = useShip(ctx);
  const { run, reset } = ship;
  // The base is the repository's default branch, which GitHub knows.
  const lookup = useQuery({
    queryKey: prKeys.lookup(ctx.target.projectId, ctx.target.targetKey, null),
    queryFn: () => prApi.lookup(ctx.target.projectId, ctx.target.workspace, null),
    enabled: open,
    staleTime: 60_000,
  });
  const base = lookup.data?.repository?.defaultBranch ?? null;
  const notGitHub = lookup.data !== undefined && !lookup.data.repository;

  useEffect(() => {
    if (open && base) void run(base);
    if (!open) reset();
  }, [open, base, run, reset]);

  const { progress } = ship;
  return (
    <Dialog
      open={open}
      title="Ship changes"
      description={`Commit what changed, push the branch and open a pull request against ${base ?? "the default branch"}, with the assistant writing the words.`}
      onCancel={() => {
        if (!progress.running) onClose();
      }}
    >
      <ol className="mt-4 space-y-1.5" aria-live="polite">
        {progress.steps.map((item) => (
          <li key={item.step} className="flex items-start gap-2 text-sm">
            <StepIcon state={item.state} />
            <span
              className={item.state === "pending" ? "text-foreground-faint" : "text-foreground"}
            >
              {STEP_LABELS[item.step]}
              {item.note ? (
                <span className="text-foreground-faint font-mono"> · {item.note}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <DialogError>
        {notGitHub
          ? "This project's remote is not on GitHub, so there is no pull request to open."
          : lookup.isError
            ? "GitHub could not be asked for the repository."
            : progress.error}
      </DialogError>
      {progress.pullRequest ? (
        <p className="text-body-md text-success mt-4">
          Opened{" "}
          <a href={progress.pullRequest.url} target="_blank" rel="noreferrer" className="underline">
            #{progress.pullRequest.number} {progress.pullRequest.title}
          </a>
          .
        </p>
      ) : null}
      <DialogActions>
        {progress.running ? (
          <button type="button" className="btn btn-danger" onClick={ship.stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {progress.error ? "Close" : "Done"}
          </button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function StepIcon({ state }: { state: "pending" | "running" | "done" | "skipped" | "failed" }) {
  const className = "mt-0.5 size-4 shrink-0";
  switch (state) {
    case "running":
      return (
        <LoaderCircle aria-label="running" className={`text-brand animate-spin ${className}`} />
      );
    case "done":
      return <Check aria-label="done" className={`text-success ${className}`} />;
    case "failed":
      return <CircleX aria-label="failed" className={`text-error ${className}`} />;
    default:
      return <CircleDashed aria-label="pending" className={`text-foreground-faint ${className}`} />;
  }
}
