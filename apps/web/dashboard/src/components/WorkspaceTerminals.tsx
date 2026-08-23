import { useState } from "react";
import type { Project } from "../api.js";
import { terminalSessionKey } from "../workspacePaths.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { type OpenTerminalSession, OpenTerminals } from "./OpenTerminals.js";
import { WebTerminal } from "./WebTerminal.js";

export function WorkspaceTerminals({
  projectId,
  worktreeId,
  worktreeSlug,
  targetLabel,
  available,
  visible,
  projects,
  onFocusSession,
}: {
  projectId: string;
  worktreeId?: string;
  worktreeSlug: string | null;
  targetLabel: string;
  available: boolean;
  visible: boolean;
  projects: Project[];
  onFocusSession: (projectId: string, worktreeSlug: string | null) => void;
}) {
  const [sessions, setSessions] = useState<OpenTerminalSession[]>([]);
  const [confirming, setConfirming] = useState(false);
  const currentKey = terminalSessionKey(projectId, worktreeId);
  const currentOpen = sessions.some((session) => session.key === currentKey);

  const addCurrent = () => {
    setConfirming(false);
    setSessions((current) => {
      if (current.some((session) => session.key === currentKey)) return current;
      return [
        ...current,
        {
          key: currentKey,
          projectId,
          worktreeId,
          worktreeSlug,
          label: targetLabel,
        },
      ];
    });
  };

  return (
    <>
      <OpenTerminals
        sessions={sessions}
        activeKey={currentKey}
        projects={projects}
        onSelect={(session) => {
          onFocusSession(session.projectId, session.worktreeSlug);
        }}
        onClose={(session) =>
          setSessions((current) => current.filter((item) => item.key !== session.key))
        }
      />
      <div className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        {sessions.map((session) => (
          <div
            key={session.key}
            className={
              session.key === currentKey
                ? "flex min-h-0 flex-1 flex-col"
                : "pointer-events-none hidden"
            }
          >
            <WebTerminal
              projectId={session.projectId}
              worktree={session.worktreeId}
              targetLabel={session.label}
              available={available}
              active={visible && session.key === currentKey}
              autoConnect
              onExit={() =>
                setSessions((current) => current.filter((item) => item.key !== session.key))
              }
            />
          </div>
        ))}
        {!currentOpen && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0d10]">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 font-mono text-xs text-gray-400">
                <span className="size-2 rounded-full bg-gray-600" />
                terminal stopped
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!available}
                onClick={() => setConfirming(true)}
              >
                Open terminal
              </button>
            </header>
            <div className="grid flex-1 place-items-center text-center font-mono text-sm text-gray-500">
              <p>
                {available
                  ? `Start an interactive shell in ${targetLabel}.`
                  : "Connect or update the Exeora CLI to enable the terminal."}
              </p>
            </div>
          </section>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Open a remote shell?"
        body={`Commands run directly on your connected machine in ${targetLabel}. Exeora does not record keystrokes, commands, or terminal output.`}
        confirmLabel="Open terminal"
        onConfirm={addCurrent}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
