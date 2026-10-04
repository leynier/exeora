/**
 * What keeps one embedding of the Workspace from reading another's state.
 *
 * The dashboard has one Workspace per tab and no scope. A ChatGPT panel may
 * share its sandbox origin, and so its storage, with other panels of the same
 * app; each sets a scope of its own so their tabs, buffers and searches stay
 * apart. Every key below also names the project and working copy.
 */

let scope = "";

export function configureWorkspaceScope(value: string): void {
  scope = value;
}

/** A storage key of the Workspace's own, apart from other embeddings'. */
export function scopedKey(key: string): string {
  return scope ? `${key}.${scope}` : key;
}

/** The key for something that belongs to one working copy of one project. */
export function targetScopedKey(projectId: string, targetKey: string, rest = ""): string {
  const base = `${projectId}:${targetKey}${rest ? `:${rest}` : ""}`;
  return scope ? `${scope}:${base}` : base;
}
