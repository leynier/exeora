import type { Project } from "../api.js";
import { repositoryLabel } from "../projectModel.js";

/**
 * The repository a project is, as one line: `github.com/owner/name`, with a
 * lock when it is private. A project that is a directory with no repository
 * says so, because that is why it cannot live anywhere else.
 */
export function RepositoryLine({
  project,
  className = "",
}: {
  project: Pick<Project, "repoUrl" | "cloud" | "github">;
  className?: string;
}) {
  const label = repositoryLabel(project.repoUrl ?? project.cloud?.repoUrl);
  // Known for a repository picked from GitHub. For any other, a token kept
  // for it is the only sign there is that it needs one.
  const isPrivate = project.github?.private ?? project.cloud?.hasCredential ?? false;

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {isPrivate && <LockIcon />}
      <span className="truncate font-mono">
        {label ?? "No repository: a directory on one machine"}
      </span>
    </span>
  );
}

export function LockIcon() {
  return (
    <span className="inline-flex shrink-0 items-center" title="private">
      <span className="sr-only">private</span>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5"
      >
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </svg>
    </span>
  );
}
