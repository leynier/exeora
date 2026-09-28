import type { GitStatus } from "../../api.js";

export type PrimaryActionId =
  | "commit"
  | "fetch"
  | "publish"
  | "sync"
  | "pull"
  | "push"
  | "stage_all";

export type PrimaryAction = {
  id: PrimaryActionId;
  label: string;
  /** Shown but not yet possible: a commit whose message is still empty. */
  disabled: boolean;
  /** Why it is disabled, for the tooltip. */
  reason?: string;
};

/**
 * The one button that reads the situation.
 *
 * Something staged is a commit waiting to happen, so that comes first, even
 * before the message is written. Conflicts block everything but a fetch.
 * Then the branch's relationship with its upstream decides: none yet is a
 * publish, both ways is a sync, behind is a pull, ahead is a push. With
 * nothing to send, staging what changed is the next step, and with nothing
 * at all, fetching is what a git client does when asked to do something.
 */
export function primaryAction(
  status: Pick<GitStatus, "files" | "upstream" | "head" | "ahead" | "behind" | "remotes">,
  messageReady: boolean,
): PrimaryAction {
  const staged = status.files.filter((file) => file.index !== "." && file.index !== "?");
  const changes = status.files.filter((file) => file.worktree !== "." || file.kind === "untracked");
  const conflicts = status.files.some((file) => file.kind === "conflict");
  if (conflicts) {
    return { id: "fetch", label: "Fetch", disabled: false };
  }
  if (staged.length > 0) {
    const files = `${staged.length} ${staged.length === 1 ? "file" : "files"}`;
    return messageReady
      ? { id: "commit", label: `Commit ${files}`, disabled: false }
      : { id: "commit", label: `Commit ${files}`, disabled: true, reason: "Write a message first" };
  }
  if (!status.upstream && status.head && status.remotes.length > 0) {
    return { id: "publish", label: "Publish branch", disabled: false };
  }
  if (status.ahead > 0 && status.behind > 0) {
    return { id: "sync", label: `Sync ${status.behind}↓ ${status.ahead}↑`, disabled: false };
  }
  if (status.behind > 0) return { id: "pull", label: `Pull ${status.behind}`, disabled: false };
  if (status.ahead > 0) return { id: "push", label: `Push ${status.ahead}`, disabled: false };
  if (changes.length > 0) return { id: "stage_all", label: "Stage changes", disabled: false };
  return { id: "fetch", label: "Fetch", disabled: false };
}
