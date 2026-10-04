import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import type { ContextWriter } from "./comments/contextWriter.js";
import type { PanelController } from "./controller.js";
import type { PanelRelay } from "./relay.js";

/**
 * What any Workspace ChatGPT can move needs around it: following the
 * controller's routes, asking before unsaved edits are left behind, and
 * telling the model where it is.
 */

/**
 * Moves the open Workspace where the controller asks next, without
 * reloading the panel. Where it asked before this mounted is where it began.
 */
export function Follow({ controller }: { controller: PanelController }) {
  const navigate = useNavigate();
  const { route, version } = useSyncExternalStore(controller.subscribe, controller.route);
  const seen = useRef(version);
  useEffect(() => {
    if (!route || seen.current === version) return;
    seen.current = version;
    navigate(route);
  }, [route, version, navigate]);
  return null;
}

/** The person's answer to a move that would leave unsaved edits. */
export function LeaveDialog({ controller }: { controller: PanelController }) {
  const pending = useSyncExternalStore(controller.subscribe, controller.pendingConfirmation);
  return (
    <ConfirmDialog
      open={pending !== null}
      title="Leave unsaved edits?"
      body={`${pending?.dirtyPaths.length === 1 ? "A file has" : `${pending?.dirtyPaths.length ?? 0} files have`} unsaved edits in this workspace. They stay in this panel if you come back, but are not saved.`}
      details={
        <ul className="font-mono text-xs">
          {pending?.dirtyPaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      }
      confirmLabel="Leave and switch"
      onConfirm={controller.confirm}
      onCancel={controller.cancel}
    />
  );
}

/**
 * Keeps the model told what the panel shows (places and names) and the
 * panel's address for its Workspace tools, through the one writer that also
 * carries the comment batches, so neither undoes the other. Unmounted, it
 * takes the workspace back out, comments staying.
 */
export function useWorkspaceContext(
  controller: PanelController,
  writer: ContextWriter,
  relay: PanelRelay | null,
) {
  useEffect(() => {
    let sent = "";
    const push = () => {
      const view = relay?.get();
      // Closed for good, the panel tells the model nothing more of where it is.
      if (view?.status === "closed") {
        sent = "";
        writer.setWorkspace(null);
        return;
      }
      const state = {
        ...controller.state(),
        ...(view?.panelId ? { panelId: view.panelId, relay: view.status } : {}),
      };
      const next = JSON.stringify(state);
      if (next === sent) return;
      sent = next;
      writer.setWorkspace(state);
    };
    push();
    const stopController = controller.subscribe(push);
    const stopRelay = relay?.subscribe(push);
    return () => {
      stopController();
      stopRelay?.();
      writer.setWorkspace(null);
    };
  }, [controller, writer, relay]);
}
