import { Tooltip } from "@exeora/design/react";
import { Info } from "lucide-react";
import { Link } from "react-router";
import type { Project } from "../api.js";
import type { WorkspaceOption } from "../projectModel.js";
import { Select } from "./Select.js";

/**
 * Project, then workspace. The Workspace tab is reachable without walking into
 * a project first, so both choices live here rather than being implied by the
 * URL the visitor arrived from.
 *
 * A workspace is named by its branch and the location it is in, because the
 * same branch can have a working copy in two locations and the slug alone
 * does not say which is which.
 *
 * Compact, for a narrow screen, the two dropdowns share one row and the link
 * to the project's page is an icon.
 */
export function WorkspaceRootSelector({
  projects,
  projectId,
  options,
  selectedSlug,
  onSelectProject,
  onSelectWorkspace,
  compact = false,
}: {
  projects: Project[];
  projectId: string;
  options: WorkspaceOption[];
  selectedSlug: string | null;
  onSelectProject: (id: string) => void;
  onSelectWorkspace: (slug: string | null) => void;
  compact?: boolean;
}) {
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));

  return (
    <div
      className={
        compact
          ? "flex w-full min-w-0 items-center gap-1.5"
          : "flex flex-wrap items-center justify-end gap-2"
      }
    >
      <div className={compact ? "min-w-0 flex-1" : undefined}>
        <Select
          label="Project"
          value={projectId}
          options={projectOptions}
          placeholder="Select a project"
          onChange={onSelectProject}
          wide={compact}
        />
      </div>
      <div className={compact ? "min-w-0 flex-1" : undefined}>
        <Select
          label="Workspace"
          value={selectedSlug ?? "main"}
          options={options}
          disabled={!projectId}
          placeholder="Select a workspace"
          onChange={(value) => onSelectWorkspace(value === "main" ? null : value)}
          wide={compact}
        />
      </div>
      {projectId ? (
        compact ? (
          <Tooltip label="Project details">
            <Link
              to={`/projects/${projectId}`}
              aria-label="Project details"
              className="text-foreground-muted hover:bg-surface-variant hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-fast"
            >
              <Info aria-hidden="true" className="size-4" />
            </Link>
          </Tooltip>
        ) : (
          <Link className="btn" to={`/projects/${projectId}`}>
            Project details
          </Link>
        )
      ) : null}
    </div>
  );
}
