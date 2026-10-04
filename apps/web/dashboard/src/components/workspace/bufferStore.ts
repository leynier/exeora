import { targetScopedKey } from "./scope.js";

/**
 * Unsaved edits, kept apart from the editor that made them.
 *
 * Only the active tab's editor is mounted, so its text would go with it on a
 * tab switch or a navigation. A buffer stays here, in memory only, until it
 * is saved or discarded, along with the version of the file it started from:
 * an editor that comes back to a file that moved on meanwhile says so rather
 * than saving over it.
 */

export interface Buffer {
  text: string;
  /** The file's version when the edit began. */
  token: string;
}

const buffers = new Map<string, Buffer>();

function key(projectId: string, targetKey: string, path: string): string {
  return targetScopedKey(projectId, targetKey, `file:${path}`);
}

export const bufferStore = {
  get: (projectId: string, targetKey: string, path: string): Buffer | undefined =>
    buffers.get(key(projectId, targetKey, path)),
  set: (projectId: string, targetKey: string, path: string, buffer: Buffer): void => {
    buffers.set(key(projectId, targetKey, path), buffer);
  },
  clear: (projectId: string, targetKey: string, path: string): void => {
    buffers.delete(key(projectId, targetKey, path));
  },
  /** Forgets every edit: signing out leaves nothing for the next account. */
  clearAll: (): void => {
    buffers.clear();
  },
  /** The files of one working copy with unsaved edits. */
  dirtyPaths: (projectId: string, targetKey: string): string[] => {
    const prefix = key(projectId, targetKey, "");
    return [...buffers.keys()]
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length))
      .sort();
  },
};
