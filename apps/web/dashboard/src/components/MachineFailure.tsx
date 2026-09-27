import type { CloudMachine } from "../api-cloud.js";

/** Whether the way out of this failure is a different token rather than another try. */
export function needsToken(machine: Pick<CloudMachine, "errorCode">): boolean {
  return machine.errorCode === "clone_auth_failed" || machine.errorCode === "repo_not_found";
}

/**
 * Why a machine failed: the sentence, and what the machine said behind it.
 *
 * The sentence is what to read. The detail is the log, folded away, for when
 * the sentence is not enough or somebody asks what happened.
 */
export function MachineFailure({ machine }: { machine: CloudMachine }) {
  return (
    <div className="min-w-0">
      <p className="text-body-md text-error">
        {machine.error ?? "The machine could not be set up."}
      </p>
      {machine.errorDetail && (
        <details className="mt-1">
          <summary className="text-body-md text-foreground-faint cursor-pointer">Details</summary>
          <pre className="border-border bg-bg text-foreground-muted mt-2 max-h-48 overflow-auto rounded-lg border p-3 text-left font-mono text-xs whitespace-pre-wrap">
            {machine.errorDetail}
          </pre>
        </details>
      )}
    </div>
  );
}
