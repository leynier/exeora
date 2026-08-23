import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { GitBranch, GitStatus, WorkspaceAction, Worktree } from "../api.js";
import { worktreeSlugForBranch } from "../workspacePaths.js";

/**
 * Branch switching belongs in the toolbar, the way GitHub Desktop and Fork
 * put it: one control that names the current branch, then a picker for locals,
 * remotes, and creating a branch from HEAD. A form of dropdowns under the
 * file list buried the thing you reach for most often and looked like settings.
 */
export function SourceControlBranchPicker({
  status,
  pending,
  projectLocalPath,
  worktrees,
  onRun,
  onSelectWorktree,
  onCreateWorktree,
  onConfirmDelete,
}: {
  status: GitStatus;
  pending: boolean;
  projectLocalPath: string;
  worktrees: Worktree[];
  onRun: (action: WorkspaceAction) => Promise<void>;
  onSelectWorktree: (slug: string | null) => void;
  onCreateWorktree: () => void;
  onConfirmDelete: (name: string) => void;
}) {
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const head = status.head ?? "detached HEAD";
  const needle = query.trim().toLowerCase();
  const local = useMemo(
    () => status.branches.filter((branch) => !branch.remote),
    [status.branches],
  );
  const remote = useMemo(
    () => status.branches.filter((branch) => branch.remote),
    [status.branches],
  );
  const current = local.find((branch) => branch.current || branch.name === status.head) ?? null;
  const locals = useMemo(
    () =>
      local
        .filter((branch) => branch !== current)
        .filter((branch) => !needle || branch.name.toLowerCase().includes(needle))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [current, local, needle],
  );
  const remotes = useMemo(
    () =>
      remote
        .filter((branch) => !needle || branch.name.toLowerCase().includes(needle))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [needle, remote],
  );
  const showCurrent = Boolean(current && (!needle || current.name.toLowerCase().includes(needle)));
  const canCreate =
    query.trim().length > 0 &&
    !local.some((branch) => branch.name.toLowerCase() === query.trim().toLowerCase());

  const place = useCallback(() => {
    const button = trigger.current;
    const menu = panel.current;
    if (!button || !menu) return;
    const anchor = button.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(anchor.width, 320)}px`;
    const gap = 6;
    const menuRect = menu.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom;
    const flip = below < menuRect.height + gap && anchor.top > below;
    menu.style.top = `${flip ? anchor.top - menuRect.height - gap : anchor.bottom + gap}px`;
    menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - menuRect.width - 8))}px`;
  }, []);

  useEffect(() => {
    const menu = panel.current;
    if (!menu) return;
    const onToggle = (event: Event) => {
      const opening = (event as ToggleEvent).newState === "open";
      setOpen(opening);
      if (!opening) {
        setQuery("");
        return;
      }
      place();
      searchBox.current?.focus();
    };
    menu.addEventListener("toggle", onToggle);
    return () => menu.removeEventListener("toggle", onToggle);
  }, [place]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (pending) panel.current?.hidePopover();
  }, [pending]);

  const close = () => panel.current?.hidePopover();
  const openBranch = (name: string) => {
    const slug = worktreeSlugForBranch(name, status.gitWorktrees, projectLocalPath, worktrees);
    if (slug !== undefined) {
      onSelectWorktree(slug);
      close();
      return;
    }
    void onRun({ action: "branch_switch", name }).then(close);
  };
  const create = () =>
    void onRun({
      action: "branch_create",
      name: query.trim(),
      startPoint: status.head ?? undefined,
    }).then(close);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={pending ? undefined : panelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current branch ${head}`}
        disabled={pending}
        className={`border-border duration-fast flex max-w-72 items-center gap-2 rounded-lg border py-1 pr-2 pl-2 transition-colors ${
          open ? "bg-surface-variant text-foreground" : "bg-surface text-foreground"
        } hover:bg-surface-variant disabled:pointer-events-none disabled:opacity-50`}
      >
        <BranchIcon />
        <span className="text-title-md min-w-0 truncate font-mono">{head}</span>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="text-label-md text-foreground-faint shrink-0 font-mono tabular-nums">
            {status.ahead > 0 ? `↑${status.ahead}` : null}
            {status.ahead > 0 && status.behind > 0 ? " " : null}
            {status.behind > 0 ? `↓${status.behind}` : null}
          </span>
        )}
        <Chevron open={open} />
      </button>

      <div
        ref={panel}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label="Branches"
        className="popover-panel border-border bg-surface-elevated fixed inset-auto m-0 flex max-h-[28rem] w-80 flex-col overflow-hidden rounded-lg border shadow-xl shadow-black/40"
        onBlur={(event) => {
          if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
            close();
          }
        }}
      >
        <div className="border-border-subtle shrink-0 border-b p-2">
          <input
            ref={searchBox}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find or create a branch"
            className="border-border bg-bg w-full rounded-md border px-2.5 py-1.5 font-mono text-xs"
            onKeyDown={(event) => {
              if (event.key === "Enter" && canCreate) {
                event.preventDefault();
                create();
              }
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="Branches">
          {canCreate && (
            <button
              type="button"
              className="hover:bg-surface-variant w-full rounded-md px-2 py-1.5 text-left"
              onClick={create}
            >
              <span className="text-body-md text-foreground block">
                Create branch <span className="font-mono">{query.trim()}</span>
              </span>
              <span className="text-label-md text-foreground-faint mt-0.5 block">from {head}</span>
            </button>
          )}
          {showCurrent && current ? (
            <BranchGroup title="Current">
              <BranchRow branch={current} current hint={syncHint(status, current)} onPick={close} />
            </BranchGroup>
          ) : null}
          {locals.length > 0 ? (
            <BranchGroup title="Local">
              {locals.map((branch) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  hint={branch.upstream ?? branch.shortOid}
                  onPick={() => openBranch(branch.name)}
                  onDelete={onConfirmDelete}
                />
              ))}
            </BranchGroup>
          ) : needle && !showCurrent ? (
            <BranchGroup title="Local" empty="No local matches" />
          ) : !current ? (
            <BranchGroup title="Local" empty="No local branches" />
          ) : null}
          {remotes.length > 0 ? (
            <BranchGroup title="Remote">
              {remotes.map((branch) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  hint="Checkout"
                  onPick={() =>
                    void onRun({
                      action: "branch_track",
                      remoteBranch: branch.name,
                      name: localNameForRemote(branch.name),
                    }).then(close)
                  }
                />
              ))}
            </BranchGroup>
          ) : needle && remote.length > 0 ? (
            <BranchGroup title="Remote" empty="No remote matches" />
          ) : null}
        </div>
        <div className="border-border-subtle shrink-0 space-y-2 border-t px-3 py-2">
          {!canCreate ? (
            <p className="text-label-md text-foreground-faint">
              Type a name to create a branch from {head}, or open a separate Git worktree.
            </p>
          ) : null}
          <button
            type="button"
            className="btn w-full"
            disabled={pending}
            onClick={() => {
              panel.current?.hidePopover();
              onCreateWorktree();
            }}
          >
            Create worktree
          </button>
        </div>
      </div>
    </>
  );
}

function BranchGroup({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string | null;
  children?: ReactNode;
}) {
  return (
    <section className="py-1">
      <h3 className="text-label-md text-foreground-faint px-2 py-1 font-mono tracking-wide uppercase">
        {title}
      </h3>
      {children}
      {empty ? <p className="text-body-md text-foreground-faint px-2 py-1">{empty}</p> : null}
    </section>
  );
}

function BranchRow({
  branch,
  current = false,
  hint,
  onPick,
  onDelete,
}: {
  branch: GitBranch;
  current?: boolean;
  hint?: string | null;
  onPick: () => void;
  onDelete?: (name: string) => void;
}) {
  return (
    <div className="group hover:bg-surface-variant flex items-center gap-1 rounded-md">
      <button
        type="button"
        role="option"
        aria-selected={current}
        className="min-w-0 flex-1 px-2 py-1.5 text-left"
        onClick={onPick}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Check shown={current} />
          <span className="min-w-0 truncate font-mono text-xs">{branch.name}</span>
        </span>
        {hint ? (
          <span className="text-label-md text-foreground-faint mt-0.5 ml-5 block truncate">
            {hint}
          </span>
        ) : null}
      </button>
      {onDelete && !current ? (
        <button
          type="button"
          className="text-label-md text-error hover:bg-error/10 invisible shrink-0 rounded px-1.5 py-1 group-hover:visible group-focus-within:visible"
          onClick={() => onDelete(branch.name)}
        >
          Delete
        </button>
      ) : null}
    </div>
  );
}

function syncHint(status: GitStatus, branch: GitBranch): string {
  const parts: string[] = [];
  if (branch.upstream) parts.push(branch.upstream);
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  return parts.join(" · ") || branch.shortOid;
}

function localNameForRemote(name: string): string {
  const slash = name.indexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function BranchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      className="text-foreground-muted size-3.5 shrink-0"
    >
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="8" r="1.6" />
      <path d="M4.5 5.1v5.8M4.5 8h5.4" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-foreground-faint duration-fast size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  );
}

function Check({ shown }: { shown: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-3 shrink-0 ${shown ? "text-foreground" : "invisible"}`}
    >
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  );
}
