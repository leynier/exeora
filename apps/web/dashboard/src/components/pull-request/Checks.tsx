import { ChevronRight, CircleCheck, CircleDashed, CircleX, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { Check, PullRequestChecks } from "../../api-pr.js";
import { ErrorBanner, Skeleton } from "../ui.js";

/** Above this many, the checks that passed start folded. */
const FOLD_PASSING_OVER = 5;

/** What CI said about the head commit, the failures first. */
export function Checks({
  checks,
  loading,
  error,
}: {
  checks: PullRequestChecks | undefined;
  loading: boolean;
  error: unknown;
}) {
  if (error) return <ErrorBanner error={error} title="Checks could not be read" />;
  if (loading || !checks) return <Skeleton className="m-4 h-10 w-[calc(100%-2rem)]" />;
  const total = checks.failing.length + checks.inProgress.length + checks.successful.length;
  if (total === 0) {
    return (
      <p className="text-body-md text-foreground-faint border-border-subtle border-b px-4 py-2">
        No checks reported for this commit.
      </p>
    );
  }
  return (
    <section aria-label="Checks" className="border-border-subtle border-b">
      <Group label="failing" checks={checks.failing} tone="text-error" open />
      <Group label="in progress" checks={checks.inProgress} tone="text-warning" open />
      <Group
        label="successful"
        checks={checks.successful}
        tone="text-success"
        open={checks.successful.length <= FOLD_PASSING_OVER}
      />
    </section>
  );
}

function Group({
  label,
  checks,
  tone,
  open: initiallyOpen,
}: {
  label: string;
  checks: Check[];
  tone: string;
  open: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  if (checks.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="text-label-md text-foreground-faint hover:text-foreground flex w-full items-center gap-1 px-3 py-1.5 font-mono tracking-wide uppercase"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 transition-transform duration-fast ${open ? "rotate-90" : ""}`}
        />
        <span className={tone}>{checks.length}</span> {label}{" "}
        {checks.length === 1 ? "check" : "checks"}
      </button>
      {open ? (
        <ul className="pb-1">
          {checks.map((check) => (
            <li key={check.id}>
              <a
                href={check.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="hover:bg-surface-variant flex items-center gap-2 px-4 py-1 text-xs"
              >
                <StateIcon state={check.state} />
                <span className="text-foreground min-w-0 flex-1 truncate">{check.name}</span>
                {check.app ? (
                  <span className="text-foreground-faint shrink-0 truncate">{check.app}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StateIcon({ state }: { state: Check["state"] }) {
  const className = "size-3.5 shrink-0";
  switch (state) {
    case "failing":
      return <CircleX aria-label="failing" className={`text-error ${className}`} />;
    case "in_progress":
      return (
        <LoaderCircle
          aria-label="in progress"
          className={`text-warning animate-spin ${className}`}
        />
      );
    case "successful":
      return <CircleCheck aria-label="successful" className={`text-success ${className}`} />;
    default:
      return <CircleDashed aria-label="neutral" className={`text-foreground-faint ${className}`} />;
  }
}
