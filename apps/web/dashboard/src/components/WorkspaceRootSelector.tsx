import { Link } from "react-router";
import type { Worktree } from "../api.js";

export function WorkspaceRootSelector({
  projectId,
  worktrees,
  selectedSlug,
  onSelect,
}: {
  projectId: string;
  worktrees: Worktree[];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="border-border bg-surface flex items-center gap-2 rounded-lg border px-3 py-2">
        <span className="text-label-md text-foreground-faint font-mono uppercase">Root</span>
        <select
          aria-label="Workspace root"
          className="bg-transparent font-mono text-sm outline-none"
          value={selectedSlug ?? "main"}
          onChange={(event) => onSelect(event.target.value === "main" ? null : event.target.value)}
        >
          <option value="main">main</option>
          {worktrees.map((worktree) => (
            <option key={worktree.id} value={worktree.slug}>
              {worktree.slug}
              {worktree.branch ? ` · ${worktree.branch}` : " · detached HEAD"}
            </option>
          ))}
        </select>
      </label>
      <Link className="btn" to={`/projects/${projectId}`}>
        Project details
      </Link>
    </div>
  );
}
