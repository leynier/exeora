import { useEffect } from "react";
import { runSave } from "./saveRegistry.js";

export type ShortcutView = "explorer" | "search" | "source";

/**
 * The editor conventions: Ctrl/Cmd+Shift+E, F and G reach the Explorer,
 * Search and Source Control, and Ctrl/Cmd+S saves whatever is being edited.
 *
 * Save is claimed only while an editor has registered, so the browser keeps
 * its own shortcut on a page that has nothing to save.
 */
export function useWorkspaceShortcuts({
  enabled,
  onView,
}: {
  enabled: boolean;
  onView: (view: ShortcutView) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s" && !event.shiftKey) {
        if (runSave()) event.preventDefault();
        return;
      }
      if (!event.shiftKey) return;
      const view = { e: "explorer", f: "search", g: "source" }[key] as ShortcutView | undefined;
      if (!view) return;
      event.preventDefault();
      onView(view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onView]);
}
