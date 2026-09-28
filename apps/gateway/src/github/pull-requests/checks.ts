/**
 * What ran against a commit, sorted into what the screen shows first.
 *
 * GitHub reports two kinds: check runs, which apps such as Actions create,
 * and commit statuses, the older API that CI services still post to. Both
 * are reduced here to one shape and one of three groups, so the dashboard
 * lists what is failing, then what is still going, and folds away what
 * passed.
 */

/** A check run as `api.ts` reads it off GitHub. */
export interface CheckRun {
  id: number;
  name: string;
  /** `queued`, `in_progress`, `completed`, or something newer. */
  status: string;
  /** Set once completed: `success`, `failure`, `neutral`, `cancelled`, `skipped`, … */
  conclusion: string | null;
  url: string | null;
  /** The app that ran it, such as GitHub Actions. */
  app: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** The summary line of its output, when it has one. */
  description: string | null;
}

/** A commit status as `api.ts` reads it off GitHub. */
export interface CommitStatus {
  id: number;
  context: string;
  /** `success`, `failure`, `error` or `pending`. */
  state: string;
  url: string | null;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type CheckState = "failing" | "in_progress" | "successful" | "neutral";

export interface Check {
  /** Unique across both kinds: check runs and statuses have separate id spaces. */
  id: string;
  name: string;
  state: CheckState;
  url: string | null;
  app: string | null;
  startedAt: string | null;
  completedAt: string | null;
  description: string | null;
}

export interface GroupedChecks {
  failing: Check[];
  inProgress: Check[];
  successful: Check[];
}

const FAILING = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
]);
const NEUTRAL = new Set(["neutral", "skipped", "stale"]);

/** The state of a check run, from what GitHub says of it. */
export function checkRunState(run: Pick<CheckRun, "status" | "conclusion">): CheckState {
  if (run.status !== "completed") return "in_progress";
  const conclusion = run.conclusion ?? "";
  if (conclusion === "success") return "successful";
  if (NEUTRAL.has(conclusion)) return "neutral";
  if (FAILING.has(conclusion)) return "failing";
  // A conclusion this file does not know is shown as a failure rather than
  // hidden among what passed: a wrong "all green" costs more than a look.
  return "failing";
}

/** The state of a commit status, from what GitHub says of it. */
export function statusState(status: Pick<CommitStatus, "state">): CheckState {
  if (status.state === "success") return "successful";
  if (status.state === "pending") return "in_progress";
  return "failing";
}

function fromRun(run: CheckRun): Check {
  return {
    id: `run:${run.id}`,
    name: run.name,
    state: checkRunState(run),
    url: run.url,
    app: run.app,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    description: run.description,
  };
}

function fromStatus(status: CommitStatus): Check {
  return {
    id: `status:${status.id}`,
    name: status.context,
    state: statusState(status),
    url: status.url,
    app: null,
    startedAt: status.createdAt,
    completedAt: status.state === "pending" ? null : status.updatedAt,
    description: status.description,
  };
}

/**
 * Both kinds in three groups, each sorted by name. Neutral and skipped
 * checks sit with the successful ones: nothing about them needs doing.
 */
export function groupChecks(runs: CheckRun[], statuses: CommitStatus[]): GroupedChecks {
  const grouped: GroupedChecks = { failing: [], inProgress: [], successful: [] };
  for (const check of [...runs.map(fromRun), ...statuses.map(fromStatus)]) {
    if (check.state === "failing") grouped.failing.push(check);
    else if (check.state === "in_progress") grouped.inProgress.push(check);
    else grouped.successful.push(check);
  }
  const byName = (a: Check, b: Check) => a.name.localeCompare(b.name);
  grouped.failing.sort(byName);
  grouped.inProgress.sort(byName);
  grouped.successful.sort(byName);
  return grouped;
}
