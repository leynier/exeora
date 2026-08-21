import { Link } from "react-router";
import type { Project, Worktree } from "../api.js";
import { Select } from "./Select.js";

/**
 * Project, then worktree. The Workspace tab is reachable without walking into
 * a project first, so both choices live here rather than being implied by the
 * URL the visitor arrived from.
 */
export function WorkspaceRootSelector({
  projects,
  projectId,
  worktrees,
  selectedSlug,
  onSelectProject,
  onSelectWorktree,
}: {
  projects: Project[];
  projectId: string;
  worktrees: Worktree[];
  selectedSlug: string | null;
  onSelectProject: (id: string) => void;
  onSelectWorktree: (slug: string | null) => void;
}) {
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));
  const worktreeOptions = [
    { value: "main", label: "main", hint: "project root" },
    ...worktrees.map((worktree) => ({
      value: worktree.slug,
      label: worktree.slug,
      hint: worktree.branch ?? "detached HEAD",
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
        label="Worktree"
        value={selectedSlug ?? "main"}
        options={worktreeOptions}
        disabled={!projectId}
        onChange={(value) => onSelectWorktree(value === "main" ? null : value)}
      />
      {projectId ? (
        <Link className="btn" to={`/projects/${projectId}`}>
          Project details
        </Link>
      ) : null}
    </div>
  );
}
