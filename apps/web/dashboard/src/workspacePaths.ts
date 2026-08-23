/** Compare machine paths the dashboard only ever sees as strings. */
export function normalizeLocalPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function sameLocalPath(left: string, right: string): boolean {
  return normalizeLocalPath(left) === normalizeLocalPath(right);
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
  const match = worktrees.find((entry) => sameLocalPath(entry.localPath, checkout.path));
  if (match) return match.slug;
  if (sameLocalPath(projectLocalPath, checkout.path)) return null;
  return undefined;
}

export function projectRootBranch(
  gitWorktrees: { path: string; branch: string | null }[] | undefined,
  projectLocalPath: string,
  worktrees: { slug: string; localPath: string }[],
): string | null {
  const root = gitWorktrees?.find((entry) => {
    if (worktrees.some((worktree) => sameLocalPath(worktree.localPath, entry.path))) return false;
    return sameLocalPath(projectLocalPath, entry.path);
  });
  return root?.branch ?? null;
}

export function terminalSessionKey(projectId: string, worktreeId?: string): string {
  return `${projectId}:${worktreeId ?? "main"}`;
}

export type ListedTerminal = {
  sessionId: string;
  projectId: string;
  worktreeId?: string;
  worktreeSlug?: string;
  startedAt: number;
};
