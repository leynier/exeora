import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { GitBranch, GitStatus, WorkspaceAction } from "../api.js";

/**
 * Branch switching belongs in the toolbar, the way GitHub Desktop and Fork
 * put it: one control that lists locals, remotes, and creating a branch.
 * A form of dropdowns at the bottom of the file list buried the thing you
 * reach for most often and looked like settings rather than a git client.
 */
export function SourceControlBranchPicker({
  status,
  pending,
  onRun,
  onConfirmDelete,
}: {
  status: GitStatus;
  pending: boolean;
  onRun: (action: WorkspaceAction) => Promise<void>;
  onConfirmDelete: (name: string) => void;
}) {
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const local = status.branches.filter((branch) => !branch.remote);
  const remote = status.branches.filter((branch) => branch.remote);
  const needle = query.trim().toLowerCase();
  const locals = useMemo(
    () => local.filter((branch) => branch.name.toLowerCase().includes(needle)),
    [local, needle],
  );
  const remotes = useMemo(
    () => remote.filter((branch) => branch.name.toLowerCase().includes(needle)),
    [remote, needle],
  );
  const canCreate =
    query.trim().length > 0 &&
    !local.some((branch) => branch.name.toLowerCase() === query.trim().toLowerCase());

  const place = useCallback(() => {
    const button = trigger.current;
    const menu = panel.current;
    if (!button || !menu) return;
    const anchor = button.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(anchor.width, 288)}px`;
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

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={pending ? undefined : panelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current branch ${status.head ?? "detached HEAD"}`}
        disabled={pending}
        className={`border-border text-title-md duration-fast flex max-w-56 items-center gap-1.5 rounded-lg border py-1 pr-2 pl-2.5 transition-colors ${
          open ? "bg-surface-variant text-foreground" : "bg-surface text-foreground"
        } hover:bg-surface-variant disabled:pointer-events-none disabled:opacity-50`}
      >
        <span className="truncate">{status.head ?? "detached HEAD"}</span>
        <Chevron open={open} />
      </button>

      <div
        ref={panel}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label="Branches"
        className="popover-panel border-border bg-surface-elevated fixed inset-auto m-0 flex max-h-96 w-80 flex-col overflow-hidden rounded-lg border shadow-xl shadow-black/40"
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
                void onRun({ action: "branch_create", name: query.trim() }).then(close);
              }
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="Branches">
          {canCreate && (
            <button
              type="button"
              className="text-body-md text-foreground hover:bg-surface-variant w-full rounded-md px-2 py-1.5 text-left"
              onClick={() =>
                void onRun({ action: "branch_create", name: query.trim() }).then(close)
              }
            >
              Create <span className="font-mono">{query.trim()}</span>
            </button>
          )}
          <BranchGroup
            title="Local"
            branches={locals}
            empty={needle ? "No local matches" : "No local branches"}
            currentName={status.head}
            onPick={(name) => {
              if (name === status.head) {
                close();
                return;
              }
              void onRun({ action: "branch_switch", name }).then(close);
            }}
            onDelete={onConfirmDelete}
          />
          {remote.length > 0 && (
            <BranchGroup
              title="Remote"
              branches={remotes}
              empty={needle ? "No remote matches" : "No remote branches"}
              onPick={(name) =>
                void onRun({
                  action: "branch_track",
                  remoteBranch: name,
                  name: name.split("/").slice(1).join("/"),
                }).then(close)
              }
            />
          )}
        </div>
      </div>
    </>
  );
}

function BranchGroup({
  title,
  branches,
  empty,
  currentName,
  onPick,
  onDelete,
}: {
  title: string;
  branches: GitBranch[];
  empty: string;
  currentName?: string | null;
  onPick: (name: string) => void;
  onDelete?: (name: string) => void;
}) {
  return (
    <section className="py-1">
      <h3 className="text-label-md text-foreground-faint px-2 py-1 font-mono tracking-wide uppercase">
        {title}
      </h3>
      {branches.length === 0 ? (
        <p className="text-body-md text-foreground-faint px-2 py-1">{empty}</p>
      ) : (
        branches.map((branch) => {
          const current = branch.current || branch.name === currentName;
          return (
            <div
              key={branch.name}
              className="group hover:bg-surface-variant flex items-center gap-1 rounded-md"
            >
              <button
                type="button"
                role="option"
                aria-selected={current}
                className="text-body-md min-w-0 flex-1 px-2 py-1.5 text-left"
                onClick={() => onPick(branch.name)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${current ? "bg-success" : "bg-transparent"}`}
                  />
                  <span className="truncate font-mono text-xs">{branch.name}</span>
                </span>
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
        })
      )}
    </section>
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
      className={`duration-fast size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  );
}
