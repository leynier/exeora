import { useEffect, useId, useRef, useState } from "react";
import type { CreateCloudProjectInput } from "../api-cloud.js";

/** A slug the gateway accepts: lowercase letters, digits and hyphens. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The last path segment of a repository URL, without `.git`. */
export function nameFromRepoUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return last.replace(/\.git$/, "");
  } catch {
    return "";
  }
}

/** Plain https, nothing in front of the host: a token belongs in its own field. */
function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/**
 * Putting a repository on a machine Exeora runs.
 *
 * The name and slug follow from the URL until someone types over them, so the
 * common case is pasting one address and pressing the button. The token field
 * is a password field and never echoed back: it goes to the gateway once,
 * where it is stored encrypted and deleted with the repository.
 */
export function AddCloudProjectDialog({
  open,
  pending,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  onSubmit: (input: CreateCloudProjectInput) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [repoUrl, setRepoUrl] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) {
      setRepoUrl("");
      setName(null);
      setDefaultBranch("main");
      setToken("");
      setUsername("");
    }
  }, [open]);

  const effectiveName = (name ?? nameFromRepoUrl(repoUrl)).trim();
  const slug = slugFromName(effectiveName);
  const branch = defaultBranch.trim();
  const ready =
    !pending && isHttpsUrl(repoUrl) && effectiveName.length > 0 && slug.length > 0 && branch;

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
      className="border-border bg-surface text-foreground m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-6 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id={titleId} className="text-title-lg">
        Add a repository
      </h2>
      <p className="text-body-md text-foreground-muted mt-2">
        Exeora clones it onto a machine it runs and connects the CLI there. The machine sleeps when
        idle and wakes on the next call.
      </p>
      <label className="mt-4 block">
        <span className={label}>Repository URL</span>
        <input
          type="url"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          disabled={pending}
          placeholder="https://github.com/you/repo.git"
          autoComplete="off"
          className={field}
        />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Name</span>
          <input
            value={name ?? nameFromRepoUrl(repoUrl)}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            placeholder="repo"
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>Default branch</span>
          <input
            value={defaultBranch}
            onChange={(event) => setDefaultBranch(event.target.value)}
            disabled={pending}
            placeholder="main"
            className={field}
          />
        </label>
      </div>
      <p className="text-body-md text-foreground-faint mt-2 font-mono text-xs">
        slug: {slug || "…"}
      </p>
      <label className="mt-3 block">
        <span className={label}>Access token</span>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={pending}
          autoComplete="off"
          placeholder="Optional, for a private repository"
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
      <p className="text-body-md text-foreground-muted mt-3">
        A token needs read access to clone and write access to push. It is stored encrypted, used
        only inside the machines of this repository, and deleted with it.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready}
          onClick={() =>
            onSubmit({
              name: effectiveName,
              slug,
              repoUrl: repoUrl.trim(),
              defaultBranch: branch,
              ...(token ? { token } : {}),
              ...(token && username.trim() ? { username: username.trim() } : {}),
            })
          }
        >
          {pending ? "Working…" : "Add repository"}
        </button>
      </div>
    </dialog>
  );
}
