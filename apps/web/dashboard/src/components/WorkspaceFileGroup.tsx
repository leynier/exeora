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
  onActionAll,
  actionAllLabel,
  disabled = false,
}: {
  title: string;
  files: GitFileState[];
  selected: WorkspaceSelection | null;
  area: WorkspaceSelection["area"];
  onSelect: (value: WorkspaceSelection) => void;
  onAction: (file: GitFileState) => void;
  actionLabel: string;
  onActionAll?: () => void;
  actionAllLabel?: string;
  disabled?: boolean;
}) {
  return (
    <section className="border-border-subtle border-b py-2">
      <header className="flex items-center justify-between gap-2 px-3 pb-1.5">
        <h2 className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
          {title} <span className="tabular-nums">{files.length}</span>
        </h2>
        {onActionAll && actionAllLabel && files.length > 0 ? (
          <button
            type="button"
            className="text-label-md text-foreground-faint hover:text-foreground rounded px-1.5 py-0.5 disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            onClick={onActionAll}
          >
            {actionAllLabel}
          </button>
        ) : null}
      </header>
      {files.length === 0 ? (
        <p className="text-body-md text-foreground-faint px-3 py-2">None</p>
      ) : (
        files.map((file) => {
          const active = selected?.path === file.path && selected.area === area;
          const code = fileStatusCode(file, area);
          const { dir, name } = splitPath(file.path);
          return (
            <div
              key={`${area}:${file.path}`}
              className={`group flex items-center gap-1 px-1.5 ${active ? "bg-accent-subtle" : ""}`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 rounded px-1.5 py-1.5 text-left"
                title={file.path}
                onClick={() => onSelect({ path: file.path, area })}
              >
                <span className="flex min-w-0 items-baseline gap-2 font-mono text-xs">
                  <span
                    className={`w-3 shrink-0 text-center font-medium ${fileStatusClass(code, file.kind)}`}
                  >
                    {code}
                  </span>
                  <span className="min-w-0 truncate">
                    {dir ? <span className="text-foreground-faint">{dir}</span> : null}
                    <span className="text-foreground">{name}</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="text-label-md text-foreground-faint hover:bg-surface-variant invisible shrink-0 rounded px-1.5 py-1 group-hover:visible group-focus-within:visible disabled:pointer-events-none"
                disabled={disabled}
                onClick={() => onAction(file)}
              >
                {actionLabel}
              </button>
            </div>
          );
        })
      )}
    </section>
  );
}

export function defaultWorkspaceSelection(status?: GitStatus): WorkspaceSelection | null {
  const staged = status?.files.find((file) => file.index !== "." && file.index !== "?");
  if (staged) return { path: staged.path, area: "staged" };
  const working = status?.files.find((file) => file.worktree !== "." || file.kind === "untracked");
  return working ? { path: working.path, area: "working" } : null;
}

/**
 * Stage and unstage move a file between lists. If the highlighted row still
 * pointed at the area it just left, the diff would ask for a working-tree
 * patch of a file that is now clean, which looks like Stage all did nothing.
 */
export function selectionAfterStatus(
  current: WorkspaceSelection | null,
  status: GitStatus,
): WorkspaceSelection | null {
  if (!current) return defaultWorkspaceSelection(status);
  const file = status.files.find((item) => item.path === current.path);
  if (!file) return defaultWorkspaceSelection(status);
  const staged = file.index !== "." && file.index !== "?";
  const working = file.worktree !== "." || file.kind === "untracked";
  if (current.area === "working") {
    if (working) return current;
    if (staged) return { path: current.path, area: "staged" };
    return defaultWorkspaceSelection(status);
  }
  if (staged) return current;
  if (working) return { path: current.path, area: "working" };
  return defaultWorkspaceSelection(status);
}

export function workspaceActionLabel(action: WorkspaceAction): string {
  return `${action.action.replaceAll("_", " ")} completed.`;
}

export function fileStatusCode(file: GitFileState, area: WorkspaceSelection["area"]): string {
  if (file.kind === "untracked") return "U";
  if (file.kind === "conflict") return "!";
  const letter = area === "staged" ? file.index : file.worktree;
  return letter === "." ? "M" : letter;
}

export function fileStatusClass(code: string, kind: GitFileState["kind"]): string {
  if (kind === "conflict" || code === "!") return "text-error";
  if (code === "D") return "text-error";
  if (code === "A" || code === "U" || code === "?") return "text-success";
  if (code === "M") return "text-warning";
  if (code === "R" || code === "C") return "text-brand";
  return "text-foreground-muted";
}

function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  if (index < 0) return { dir: "", name: path };
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}
