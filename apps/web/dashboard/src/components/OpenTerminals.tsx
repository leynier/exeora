import type { Project } from "../api.js";

export type OpenTerminalSession = {
  key: string;
  projectId: string;
  worktreeId?: string;
  worktreeSlug: string | null;
  label: string;
};

export function OpenTerminals({
  sessions,
  activeKey,
  projects,
  onSelect,
  onClose,
}: {
  sessions: OpenTerminalSession[];
  activeKey: string;
  projects: Project[];
  onSelect: (session: OpenTerminalSession) => void;
  onClose: (session: OpenTerminalSession) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className="mb-3 flex min-h-0 shrink-0 flex-wrap items-center gap-2">
      <span className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
        Terminals
      </span>
      {sessions.map((session) => {
        const project = projects.find((item) => item.id === session.projectId);
        const name = project?.name ?? session.label;
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
              <span className="text-foreground-faint"> / {session.label}</span>
            </button>
            <button
              type="button"
              className="text-label-md text-foreground-faint hover:text-error rounded px-1.5 py-0.5"
              aria-label={`Close terminal ${session.label}`}
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
