/** Compare machine paths the dashboard only ever sees as strings. */
export function normalizeLocalPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function pathsRelated(left: string, right: string): boolean {
  const a = normalizeLocalPath(left);
  const b = normalizeLocalPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Which Exeora worktree currently has `branch` checked out.
 *
 * `null` is the project root. `undefined` means Git does not have that branch
 * in any known worktree, so Source Control may still switch in place.
 */
export function worktreeSlugForBranch(
  branch: string,
  gitWorktrees: { path: string; branch: string | null }[] | undefined,
  projectLocalPath: string,
  worktrees: { slug: string; localPath: string }[],
): string | null | undefined {
  const checkout = gitWorktrees?.find((entry) => entry.branch === branch);
  if (!checkout) return undefined;
  const match = worktrees.find((entry) => pathsRelated(entry.localPath, checkout.path));
  if (match) return match.slug;
  if (pathsRelated(projectLocalPath, checkout.path)) return null;
  return undefined;
}

export function projectRootBranch(
  gitWorktrees: { path: string; branch: string | null }[] | undefined,
  projectLocalPath: string,
  worktrees: { slug: string; localPath: string }[],
): string | null {
  const root = gitWorktrees?.find((entry) => {
    if (worktrees.some((worktree) => pathsRelated(worktree.localPath, entry.path))) return false;
    return pathsRelated(projectLocalPath, entry.path);
  });
  return root?.branch ?? null;
}

export function terminalSessionKey(projectId: string, worktreeId?: string): string {
  return `${projectId}:${worktreeId ?? "main"}`;
}
