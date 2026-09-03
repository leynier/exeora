import { useState } from "react";
import { terminalSessionKey } from "../workspacePaths.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useTerminals } from "./Terminals.js";

export function WorkspaceTerminals({
  projectId,
  workspaceId,
  workspaceSlug,
  targetLabel,
  available,
  visible,
}: {
  projectId: string;
  workspaceId?: string;
  workspaceSlug: string | null;
  targetLabel: string;
  available: boolean;
  visible: boolean;
}) {
  const { sessions, openSession } = useTerminals();
  const [confirming, setConfirming] = useState(false);
  const currentKey = terminalSessionKey(projectId, workspaceId);
  const currentOpen = sessions.some((session) => session.key === currentKey);

  if (!visible || currentOpen) return null;

  return (
    <>
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
      <ConfirmDialog
        open={confirming}
        title="Open a remote shell?"
        body={`Commands run directly on your connected machine in ${targetLabel}. Exeora does not record keystrokes, commands, or terminal output.`}
        confirmLabel="Open terminal"
        onConfirm={() => {
          setConfirming(false);
          openSession({
            key: currentKey,
            projectId,
            workspaceId,
            workspaceSlug,
            label: targetLabel,
          });
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
