import type { Project } from "../api.js";
import { defaultBranchOf, rootLabel } from "../projectModel.js";

export type OpenTerminalSession = {
  key: string;
  projectId: string;
  workspaceId?: string;
  workspaceSlug: string | null;
  label: string;
};

/**
 * What a session is called. One the Workspace page opened carries the name it
 * had there. One that outlived a reload comes back from the gateway with a
 * slug or nothing, and nothing is the project root, named by its branch.
 */
export function sessionLabel(session: OpenTerminalSession, projects: readonly Project[]): string {
  if (session.label) return session.label;
  const project = projects.find((item) => item.id === session.projectId);
  return rootLabel(defaultBranchOf(project));
}

export function OpenTerminals({
  sessions,
  activeKey,
  projects,
  className = "mb-3",
  onSelect,
  onClose,
}: {
  sessions: OpenTerminalSession[];
  activeKey: string;
  projects: Project[];
  className?: string;
  onSelect: (session: OpenTerminalSession) => void;
  onClose: (session: OpenTerminalSession) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className={`flex min-h-0 shrink-0 flex-wrap items-center gap-2 ${className}`}>
      <span className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
        Terminals
      </span>
      {sessions.map((session) => {
        const project = projects.find((item) => item.id === session.projectId);
        const label = sessionLabel(session, projects);
        const name = project?.name ?? label;
        const selected = session.key === activeKey;
        return (
          <span
            key={session.key}
            className={`border-border inline-flex items-center gap-1 rounded-lg border py-1 pr-1 pl-2 ${
              selected ? "bg-surface-variant text-foreground" : "bg-surface text-foreground-muted"
            }`}
          >
            <button
              type="button"
              className="text-body-md max-w-56 truncate font-mono"
              onClick={() => onSelect(session)}
            >
              {name}
              <span className="text-foreground-faint"> / {label}</span>
            </button>
            <button
              type="button"
              className="text-label-md text-foreground-faint hover:text-error rounded px-1.5 py-0.5"
              aria-label={`Close terminal ${label}`}
              onClick={() => onClose(session)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}
