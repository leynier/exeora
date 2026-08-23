import { useEffect, useId, useRef, useState } from "react";

export function CreateWorktreeDialog({
  open,
  pending,
  defaultBranch,
  fromHead,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  defaultBranch: string;
  fromHead: string | null;
  onSubmit: (input: { branch: string; reuseExistingBranch: boolean }) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [branch, setBranch] = useState(defaultBranch);
  const [reuseExistingBranch, setReuseExistingBranch] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) {
      setBranch(defaultBranch);
      setReuseExistingBranch(false);
    }
  }, [open, defaultBranch]);

  const name = branch.trim();

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="border-border bg-surface text-foreground m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border p-6 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id={titleId} className="text-title-lg">
        Create a Git worktree?
      </h2>
      <p className="text-body-md text-foreground-muted mt-2">
        This adds a separate checkout on the connected machine and switches Source Control to it.
        The current worktree stays on {fromHead ?? "its current branch"}.
      </p>
      <label className="mt-4 block">
        <span className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
          Branch
        </span>
        <input
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          disabled={pending}
          placeholder="new-branch"
          className="border-border bg-bg mt-2 w-full rounded-lg border px-3 py-2 font-mono text-xs"
        />
      </label>
      {name.length > 0 && name === fromHead ? (
        <p className="text-body-md text-foreground-muted mt-2">
          {name} is already checked out here. Use a new branch name, or an existing branch that is
          not open in another worktree.
        </p>
      ) : null}
      <label className="text-body-md mt-3 flex items-start gap-2">
        <input
          type="checkbox"
          checked={reuseExistingBranch}
          disabled={pending}
          onChange={(event) => setReuseExistingBranch(event.target.checked)}
          className="mt-1"
        />
        <span>Use an existing local branch instead of creating {name || "this branch"}.</span>
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || name.length === 0 || name === fromHead}
          onClick={() => onSubmit({ branch: name, reuseExistingBranch })}
        >
          {pending ? "Working…" : "Create worktree"}
        </button>
      </div>
    </dialog>
  );
}
