import type { Project } from "../api.js";
import { defaultBranchOf, rootLabel } from "../projectModel.js";
import { otherRootLabel, parseSelector } from "../selectors.js";

export type OpenTerminalSession = {
  key: string;
  projectId: string;
  /**
   * What the requests name: a workspace's id, or the selector of the root of
   * a location other than the default. Absent for the default one's root.
   */
  workspaceId?: string;
  /** What the address of the Workspace page takes to show this session. */
  workspaceSlug: string | null;
  label: string;
};

/**
 * What a session is called. One the Workspace page opened carries the name it
 * had there. One that outlived a reload comes back from the gateway with a
 * selector or nothing: nothing is the root of the default location, named by
 * its branch, and `main@desktop` is the desktop's root, named by its location.
 */
export function sessionLabel(session: OpenTerminalSession, projects: readonly Project[]): string {
  if (session.label) return session.label;
  const project = projects.find((item) => item.id === session.projectId);
  const parsed = parseSelector(session.workspaceSlug);
  if (parsed.root && parsed.location !== null) {
    const location = project?.locations.find((entry) => entry.slug === parsed.location);
    return otherRootLabel(location ?? { name: parsed.location });
  }
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
