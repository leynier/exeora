import { useEffect, useId, useRef, useState } from "react";
import type { CreateCloudWorkspaceInput } from "../api-cloud.js";

/**
 * A new branch on its own cloud machine.
 *
 * Unlike a local workspace there is no HEAD to start from: the machine clones
 * the repository fresh, checks the branch out if the remote has it, and
 * otherwise creates it from the base named here. The base only matters in
 * that second case, which the copy says so nobody wonders.
 */
export function AddCloudWorkspaceDialog({
  open,
  pending,
  defaultBranch,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  defaultBranch: string;
  onSubmit: (input: CreateCloudWorkspaceInput) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState(defaultBranch);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) {
      setBranch("");
      setFrom(defaultBranch);
    }
  }, [open, defaultBranch]);

  const name = branch.trim();
  const base = from.trim();
  const field =
    "border-border bg-bg text-foreground mt-2 w-full rounded-lg border px-3 py-2 font-mono text-xs";
  const label = "text-label-md text-foreground-faint font-mono tracking-wide uppercase";

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
        Add a cloud workspace
      </h2>
      <p className="text-body-md text-foreground-muted mt-2">
        A separate machine with its own clone of the repository. If the branch exists on the remote
        it is checked out; otherwise it is created from the base below, and pushed the first time
        you push.
      </p>
      <label className="mt-4 block">
        <span className={label}>Branch</span>
        <input
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          disabled={pending}
          placeholder="feature/name"
          className={field}
        />
      </label>
      <label className="mt-3 block">
        <span className={label}>Start from</span>
        <input
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          disabled={pending}
          placeholder={defaultBranch}
          className={field}
        />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || name.length === 0 || name === base}
          onClick={() =>
            onSubmit(
              base && base !== defaultBranch ? { branch: name, from: base } : { branch: name },
            )
          }
        >
          {pending ? "Working…" : "Add workspace"}
        </button>
      </div>
    </dialog>
  );
}
