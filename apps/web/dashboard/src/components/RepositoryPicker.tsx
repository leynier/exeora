import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { errorText, relativeTime } from "../api.js";
import type { GitHubRepository } from "../api-projects.js";
import { useGitHubRepositories } from "../queries.js";
import { fieldClass, fieldLabelClass } from "./Dialog.js";
import { LockIcon } from "./RepositoryLine.js";

/** Long enough that typing a name is one request, short enough not to feel like waiting. */
const DEBOUNCE_MS = 250;

/**
 * The repositories of a connected GitHub account, searched as they are typed.
 *
 * A combobox: focus stays in the search field, the arrows move through the
 * list and Enter picks, so choosing one is typing a few letters and pressing
 * two keys. A repository that is already a project is listed as a link to
 * that project and cannot be picked, because one repository is one project.
 */
export function RepositoryPicker({
  selected,
  disabled,
  onSelect,
  onNavigate,
}: {
  selected: GitHubRepository | null;
  disabled: boolean;
  onSelect: (repository: GitHubRepository) => void;
  /** Called when a link to an existing project is followed, to close the dialog. */
  onNavigate: () => void;
}) {
  const listId = useId();
  const inputId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const repositories = useGitHubRepositories(query);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const rows = repositories.data ?? [];
  const choosable = rows.filter((row) => row.projectId === null);
  const current = choosable[Math.min(active, choosable.length - 1)];
  const optionId = (row: GitHubRepository) => `${listId}-${row.id}`;

  // The list is scrolled by the keyboard as well as the wheel, so the row the
  // arrows are on has to be brought into view.
  useEffect(() => {
    if (!current) return;
    list.current
      ?.querySelector(`[data-repository="${current.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <div className="mt-4">
      <label htmlFor={inputId} className={fieldLabelClass}>
        Repository on GitHub
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? optionId(current) : undefined}
        value={text}
        disabled={disabled}
        placeholder="Search by owner or name"
        autoComplete="off"
        // The list arrives after the dialog has opened and focused whatever
        // was there. Searching is what the dialog is for, so focus comes here.
        // biome-ignore lint/a11y/noAutofocus: inside a modal dialog
        autoFocus
        className={fieldClass}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (choosable.length === 0) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((index) => (index + step + choosable.length) % choosable.length);
          } else if (event.key === "Enter" && current) {
            event.preventDefault();
            onSelect(current);
          }
        }}
      />

      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Repositories"
        className="border-border bg-bg mt-2 max-h-56 overflow-y-auto rounded-lg border p-1"
      >
        {repositories.isError ? (
          <p role="alert" className="text-body-md text-error px-2 py-1.5">
            {errorText(repositories.error, "GitHub did not answer.")}
          </p>
        ) : repositories.isLoading ? (
          <p className="text-body-md text-foreground-faint px-2 py-1.5">Loading repositories…</p>
        ) : rows.length === 0 ? (
          <p className="text-body-md text-foreground-faint px-2 py-1.5">
            {query
              ? `No repository matches "${query}". It may not be one Exeora was given on GitHub.`
              : "Exeora was given no repositories on GitHub yet."}
          </p>
        ) : (
          rows.map((row) =>
            row.projectId ? (
              <Link
                key={row.id}
                to={`/projects/${row.projectId}`}
                onClick={onNavigate}
                className="text-body-md text-foreground-faint hover:bg-surface-variant hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <RepositoryName row={row} />
                <span className="ml-auto shrink-0 underline">already a project</span>
              </Link>
            ) : (
              // Focus stays in the search field, so a row is picked with the
              // pointer or with Enter from there and is not a tab stop itself.
              <button
                key={row.id}
                id={optionId(row)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={selected?.id === row.id}
                data-repository={row.id}
                disabled={disabled}
                className={`text-body-md flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:pointer-events-none disabled:opacity-50 ${
                  selected?.id === row.id
                    ? "bg-accent-subtle text-foreground"
                    : current?.id === row.id
                      ? "bg-surface-variant text-foreground"
                      : "text-foreground-muted hover:bg-surface-variant hover:text-foreground"
                }`}
                onClick={() => onSelect(row)}
              >
                <RepositoryName row={row} />
                <span className="text-foreground-faint ml-auto shrink-0">
                  {row.pushedAt ? `pushed ${relativeTime(row.pushedAt)}` : "empty"}
                </span>
              </button>
            ),
          )
        )}
      </div>
    </div>
  );
}

function RepositoryName({ row }: { row: GitHubRepository }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.private && <LockIcon />}
      <span className="truncate font-mono">{row.fullName}</span>
    </span>
  );
}
