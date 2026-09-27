import { Link } from "react-router";
import type { Project } from "../api.js";
import { CopyButton } from "./CopyButton.js";
import { RepositoryLine } from "./RepositoryLine.js";
import { StateDot } from "./StateBadge.js";
import { Badge } from "./ui.js";

/**
 * A project in the list: what it is and where it lives, at a glance.
 *
 * It has no actions of its own. The project's page is where a project is
 * changed or removed, and this is the way there; the only thing offered here
 * is the URL a client needs, behind a disclosure because most visits are not
 * about connecting one.
 */
export function ProjectCard({
  project,
  workspaces,
  leaving,
}: {
  project: Project;
  /** Null while the machines that know the count are still loading. */
  workspaces: number | null;
  leaving: boolean;
}) {
  return (
    <article className="border-border bg-surface rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to={`/projects/${project.id}`}
              className="text-title-lg hover:text-brand transition-colors duration-fast"
            >
              {project.name}
            </Link>
            {leaving && <Badge>removing</Badge>}
            {project.github?.lostAccess && <Badge tone="error">lost access</Badge>}
          </span>
          <p className="text-body-md text-foreground-faint mt-1 flex min-w-0">
            <RepositoryLine project={project} />
          </p>
        </div>
        {workspaces !== null && (
          <p className="text-body-md text-foreground-faint shrink-0 tabular-nums">
            {workspaces} {workspaces === 1 ? "workspace" : "workspaces"}
          </p>
        )}
      </div>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label={`Locations of ${project.name}`}>
        {project.locations.map((location) => (
          <li
            key={location.id}
            className="border-border text-body-md text-foreground-muted inline-flex items-center gap-2 rounded-lg border px-2.5 py-1"
          >
            <StateDot state={location.state} />
            <span className="max-w-48 truncate">{location.name}</span>
            {location.default && (
              <span className="text-label-md text-brand font-mono uppercase">default</span>
            )}
          </li>
        ))}
      </ul>

      <details className="mt-4">
        <summary className="text-body-md text-foreground-muted hover:text-foreground">
          Connect a client
        </summary>
        <div className="border-border bg-bg mt-2 flex items-center gap-3 rounded-lg border px-3 py-2">
          <code className="text-body-md text-foreground-muted min-w-0 flex-1 truncate font-mono">
            {project.mcpUrl}
          </code>
          <CopyButton value={project.mcpUrl} label="Copy URL" />
        </div>
      </details>
    </article>
  );
}
