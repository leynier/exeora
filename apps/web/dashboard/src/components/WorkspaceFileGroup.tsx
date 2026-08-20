import type { GitFileState, GitStatus, WorkspaceAction } from "../api.js";

export type WorkspaceSelection = { path: string; area: "working" | "staged" };

export function WorkspaceFileGroup({
  title,
  files,
  selected,
  area,
  onSelect,
  onAction,
  actionLabel,
}: {
  title: string;
  files: GitFileState[];
  selected: WorkspaceSelection | null;
  area: WorkspaceSelection["area"];
  onSelect: (value: WorkspaceSelection) => void;
  onAction: (file: GitFileState) => void;
  actionLabel: string;
}) {
  return (
    <section className="border-b border-border-subtle py-3">
      <h2 className="px-4 pb-2 font-mono text-xs uppercase tracking-wide text-foreground-faint">
        {title} <span className="tabular-nums">{files.length}</span>
      </h2>
      {files.map((file) => (
        <div
          key={`${area}:${file.path}`}
          className={`group flex items-center gap-2 px-2 py-0.5 ${selected?.path === file.path && selected.area === area ? "bg-accent-subtle" : ""}`}
        >
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left font-mono text-xs"
            title={file.path}
            onClick={() => onSelect({ path: file.path, area })}
          >
            <span
              className={
                file.kind === "conflict"
                  ? "text-error"
                  : file.kind === "untracked"
                    ? "text-success"
                    : "text-foreground-muted"
              }
            >
              {file.kind === "untracked" ? "U" : area === "staged" ? file.index : file.worktree}
            </span>{" "}
            {file.path}
          </button>
          <button
            type="button"
            className="invisible rounded px-1.5 py-1 text-xs text-foreground-faint hover:bg-surface-variant group-hover:visible group-focus-within:visible"
            onClick={() => onAction(file)}
          >
            {actionLabel}
          </button>
        </div>
      ))}
    </section>
  );
}

export function defaultWorkspaceSelection(status?: GitStatus): WorkspaceSelection | null {
  const staged = status?.files.find((file) => file.index !== "." && file.index !== "?");
  if (staged) return { path: staged.path, area: "staged" };
  const working = status?.files.find((file) => file.worktree !== "." || file.kind === "untracked");
  return working ? { path: working.path, area: "working" } : null;
}

export function workspaceActionLabel(action: WorkspaceAction): string {
  return `${action.action.replaceAll("_", " ")} completed.`;
}
