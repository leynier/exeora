import { Link } from "react-router";
import type { Project, Workspace } from "../api.js";
import { Select } from "./Select.js";

/**
 * Project, then workspace. The Workspace tab is reachable without walking into
 * a project first, so both choices live here rather than being implied by the
 * URL the visitor arrived from.
 */
export function WorkspaceRootSelector({
  projects,
  projectId,
  workspaces,
  selectedSlug,
  projectRootBranch,
  onSelectProject,
  onSelectWorkspace,
}: {
  projects: Project[];
  projectId: string;
  workspaces: Workspace[];
  selectedSlug: string | null;
  projectRootBranch?: string | null;
  onSelectProject: (id: string) => void;
  onSelectWorkspace: (slug: string | null) => void;
}) {
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));
  const workspaceOptions = [
    {
      value: "main",
      label: "project root",
      hint: projectRootBranch ?? "primary checkout",
    },
    ...workspaces.map((workspace) => ({
      value: workspace.slug,
      label: workspace.slug,
      hint: workspace.branch ?? "detached HEAD",
    })),
  ];

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
        options={workspaceOptions}
        disabled={!projectId}
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
