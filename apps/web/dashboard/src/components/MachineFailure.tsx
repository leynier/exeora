/** What a failure carries, whether it is an instance's or a location's. */
export interface Failure {
  error: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
}

/** Whether the way out of this failure is a different token rather than another try. */
export function needsToken(machine: Pick<Failure, "errorCode">): boolean {
  return machine.errorCode === "clone_auth_failed" || machine.errorCode === "repo_not_found";
}

/**
 * Why something failed: the sentence, and what the machine said behind it.
 *
 * The sentence is what to read. The detail is the log, folded away, for when
 * the sentence is not enough or somebody asks what happened.
 */
export function MachineFailure({
  machine,
  fallback = "The instance could not be set up. Retry, and check the details if it fails again.",
}: {
  machine: Failure;
  /** What to say when the gateway recorded a failure and no sentence for it. */
  fallback?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-body-md text-error">{machine.error ?? fallback}</p>
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
