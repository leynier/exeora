import type { GitStatus } from "../../api.js";

export type ShipStep =
  | "stage"
  | "commit_message"
  | "branch"
  | "commit"
  | "pr_text"
  | "push"
  | "pull_request";

export type ShipStepState = "pending" | "running" | "done" | "skipped" | "failed";

/**
 * What shipping has to do from here, in order, and what each step needs.
 *
 * Pure, so the plan can be shown before anything runs and tested without
 * a machine: whether there is anything to stage, whether a branch has to
 * be made because HEAD is the base, and whether a push needs an upstream.
 */
export function shipPlan(
  status: Pick<GitStatus, "files" | "head" | "upstream" | "remotes">,
  base: string,
): { steps: ShipStep[]; onBase: boolean; hasChanges: boolean; hasStaged: boolean } {
  const staged = status.files.some((file) => file.index !== "." && file.index !== "?");
  const unstaged = status.files.some((file) => file.worktree !== "." || file.kind === "untracked");
  const onBase = status.head === base;
  const steps: ShipStep[] = [];
  if (unstaged) steps.push("stage");
  if (staged || unstaged) steps.push("commit_message");
  if (onBase) steps.push("branch");
  if (staged || unstaged) steps.push("commit");
  steps.push("pr_text", "push", "pull_request");
  return { steps, onBase, hasChanges: staged || unstaged, hasStaged: staged };
}

/** A branch name from a commit subject: lower case, dashes, at most 48 characters. */
export function branchFromSubject(subject: string, taken: readonly string[]): string {
  const slug =
    subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "changes";
  let name = slug;
  let n = 2;
  while (taken.includes(name)) {
    name = `${slug}-${n}`;
    n += 1;
  }
  return name;
}

export const STEP_LABELS: Record<ShipStep, string> = {
  stage: "Stage every change",
  commit_message: "Write the commit message",
  branch: "Create a branch off the base",
  commit: "Commit",
  pr_text: "Write the pull request",
  push: "Push the branch",
  pull_request: "Open the pull request",
};
