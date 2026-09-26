import { useEffect, useId, useRef, useState } from "react";

/**
 * Replacing, or removing, the token a repository was added with.
 *
 * The way out of a private repository that failed to clone: the token was
 * wrong or has expired, and Retry alone would clone with the same one. The
 * new token reaches machines created or retried from now on; the ones
 * already running keep what they were set up with.
 */
export function SetCloudCredentialDialog({
  open,
  pending,
  projectName,
  hasCredential,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  projectName: string;
  hasCredential: boolean;
  onSubmit: (input: { token: string | null; username?: string }) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) {
      setToken("");
      setUsername("");
    }
  }, [open]);

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
        {hasCredential ? "Replace the token" : "Set a token"} for {projectName}
      </h2>
      <p className="text-body-md text-foreground-muted mt-2">
        Used by machines created or retried from now on. Machines already running keep the token
        they were set up with.
      </p>
      <label className="mt-4 block">
        <span className={label}>Access token</span>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={pending}
          autoComplete="off"
          className={field}
        />
      </label>
      <label className="mt-3 block">
        <span className={label}>Token username</span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={pending || token.length === 0}
          autoComplete="off"
          placeholder="x-access-token"
          className={field}
        />
      </label>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        {hasCredential && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending}
            onClick={() => onSubmit({ token: null })}
          >
            Remove token
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || token.trim().length === 0}
          onClick={() =>
            onSubmit(
              username.trim()
                ? { token: token.trim(), username: username.trim() }
                : { token: token.trim() },
            )
          }
        >
          {pending ? "Working…" : "Save token"}
        </button>
      </div>
    </dialog>
  );
}
