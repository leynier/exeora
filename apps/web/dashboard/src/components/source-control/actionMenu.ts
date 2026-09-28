import type { MenuEntry } from "@exeora/design/react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowDownUp,
  Download,
  GitCommitHorizontal,
  Minus,
  Pencil,
  Plus,
  Rocket,
  Undo2,
  Upload,
} from "lucide-react";
import type { GitStatus } from "../../api.js";

export type MenuCommand =
  | "commit"
  | "commit_push"
  | "commit_sync"
  | "amend"
  | "stage_all"
  | "unstage_all"
  | "discard_all"
  | "fetch"
  | "pull"
  | "push"
  | "sync"
  | "publish"
  | "stash"
  | "stash_pop"
  | "ship";

/**
 * Everything under the chevron, each disabled with its reason rather than
 * hidden, so what git could do here is always on the list.
 */
export function actionMenu(
  status: GitStatus,
  options: { messageReady: boolean; v2: boolean; pending: boolean; ship?: string | true },
  onCommand: (command: MenuCommand) => void,
): MenuEntry[] {
  const staged = status.files.some((file) => file.index !== "." && file.index !== "?");
  const changes = status.files.some((file) => file.worktree !== "." || file.kind === "untracked");
  const tracked = status.files.some((file) => file.kind === "tracked" && file.worktree !== ".");
  const conflicts = status.files.some((file) => file.kind === "conflict");
  const remote = status.remotes[0] !== undefined;
  const older = options.v2 ? undefined : "Update the Exeora CLI on the machine";
  const commitBlocked = conflicts
    ? "Resolve conflicts first"
    : !staged
      ? "Nothing is staged"
      : !options.messageReady
        ? "Write a message first"
        : undefined;
  const item = (
    label: string,
    command: MenuCommand,
    icon: LucideIcon,
    reason: string | undefined,
    danger = false,
  ): MenuEntry => ({
    label,
    icon,
    danger,
    disabled: options.pending || reason !== undefined,
    reason,
    onSelect: () => onCommand(command),
  });
  return [
    item(
      "Ship changes",
      "ship",
      Rocket,
      options.ship === undefined
        ? "Link an assistant and GitHub in Settings"
        : options.ship === true
          ? conflicts
            ? "Resolve conflicts first"
            : undefined
          : options.ship,
    ),
    { separator: true },
    item("Commit", "commit", GitCommitHorizontal, commitBlocked),
    item(
      "Commit & Push",
      "commit_push",
      Upload,
      commitBlocked ?? (remote ? undefined : "No remote"),
    ),
    item(
      "Commit & Sync",
      "commit_sync",
      ArrowDownUp,
      commitBlocked ?? (status.upstream ? undefined : "Set an upstream first"),
    ),
    item(
      "Amend last commit",
      "amend",
      Pencil,
      older ?? (conflicts ? "Resolve conflicts first" : status.oid ? undefined : "No commit yet"),
    ),
    { separator: true },
    item("Stage all", "stage_all", Plus, changes ? undefined : "Nothing to stage"),
    item("Unstage all", "unstage_all", Minus, staged ? undefined : "Nothing is staged"),
    item(
      "Discard all changes",
      "discard_all",
      Undo2,
      older ?? (tracked ? undefined : "No tracked changes"),
      true,
    ),
    { separator: true },
    item("Fetch", "fetch", ArrowDownToLine, undefined),
    item("Pull", "pull", Download, status.upstream ? undefined : "No upstream"),
    item("Push", "push", Upload, status.upstream ? undefined : "No upstream"),
    item("Sync", "sync", ArrowDownUp, status.upstream ? undefined : "Set an upstream first"),
    item(
      "Publish branch",
      "publish",
      Upload,
      status.upstream ? "Already published" : remote ? undefined : "No remote",
    ),
    { separator: true },
    item("Stash", "stash", Archive, older ?? (changes || staged ? undefined : "Nothing to stash")),
    item(
      "Stash pop",
      "stash_pop",
      ArchiveRestore,
      older ?? ((status.stashes ?? 0) > 0 ? undefined : "No stash"),
    ),
  ];
}
