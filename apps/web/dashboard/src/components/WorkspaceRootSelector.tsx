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
 */
export function WorkspaceRootSelector({
  projects,
  projectId,
  options,
  selectedSlug,
  onSelectProject,
  onSelectWorkspace,
}: {
  projects: Project[];
  projectId: string;
  options: WorkspaceOption[];
  selectedSlug: string | null;
  onSelectProject: (id: string) => void;
  onSelectWorkspace: (slug: string | null) => void;
}) {
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select
        label="Project"
        value={projectId}
        options={projectOptions}
        placeholder="Select a project"
        onChange={onSelectProject}
      />
      <Select
        label="Workspace"
        value={selectedSlug ?? "main"}
        options={options}
        disabled={!projectId}
        placeholder="Select a workspace"
        onChange={(value) => onSelectWorkspace(value === "main" ? null : value)}
      />
      {projectId ? (
        <Link className="btn" to={`/projects/${projectId}`}>
          Project details
        </Link>
      ) : null}
    </div>
  );
}
