/**
 * Whoever holds unsaved work registers here, so one Ctrl/Cmd+S on the page
 * reaches the editor that is open rather than the browser's save dialog.
 *
 * One at a time: the tab that is showing is the one being edited. A tab that
 * unmounts unregisters, so a stale handler never saves into the void.
 */

type Saver = () => void;

let current: Saver | null = null;

export function registerSave(save: Saver): () => void {
  current = save;
  return () => {
    if (current === save) current = null;
  };
}

/** Runs the registered save, and says whether there was one. */
export function runSave(): boolean {
  if (!current) return false;
  current();
  return true;
}
