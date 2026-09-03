/** Compare machine paths the dashboard only ever sees as strings. */
export function normalizeLocalPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function sameLocalPath(left: string, right: string): boolean {
  return normalizeLocalPath(left) === normalizeLocalPath(right);
}

/**
 * Which Exeora workspace currently has `branch` checked out.
 *
 * `null` is the project root. `undefined` means Git does not have that branch
 * in any known workspace, so Source Control may still switch in place.
 */
export function workspaceSlugForBranch(
  branch: string,
  gitWorkspaces: { path: string; branch: string | null }[] | undefined,
  projectLocalPath: string,
  workspaces: { slug: string; localPath: string }[],
): string | null | undefined {
  const checkout = gitWorkspaces?.find((entry) => entry.branch === branch);
  if (!checkout) return undefined;
  const match = workspaces.find((entry) => sameLocalPath(entry.localPath, checkout.path));
  if (match) return match.slug;
  if (sameLocalPath(projectLocalPath, checkout.path)) return null;
  return undefined;
}

export function projectRootBranch(
  gitWorkspaces: { path: string; branch: string | null }[] | undefined,
  projectLocalPath: string,
  workspaces: { slug: string; localPath: string }[],
): string | null {
  const root = gitWorkspaces?.find((entry) => {
    if (workspaces.some((workspace) => sameLocalPath(workspace.localPath, entry.path)))
      return false;
    return sameLocalPath(projectLocalPath, entry.path);
  });
  return root?.branch ?? null;
}

export function terminalSessionKey(projectId: string, workspaceId?: string): string {
  return `${projectId}:${workspaceId ?? "main"}`;
}

export type ListedTerminal = {
  sessionId: string;
  projectId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  startedAt: number;
};
