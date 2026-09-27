/** Compare machine paths the dashboard only ever sees as strings. */
export function normalizeLocalPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function sameLocalPath(left: string, right: string): boolean {
  return normalizeLocalPath(left) === normalizeLocalPath(right);
}

/**
 * The root of the location whose git status is being read: where it is on
 * that machine, and the selector that opens it. The selector is null in the
 * default location and `main@desktop` in any other.
 *
 * A git status only knows the machine it ran on. The root it lists is that
 * location's, and the workspaces it lists are the ones on that machine, so
 * both are given by whoever knows which location is on screen and neither is
 * taken to be the project's default.
 */
export type LocationRoot = { path: string; selector: string | null };

/**
 * Which Exeora workspace currently has `branch` checked out.
 *
 * The root's own selector is the root, which is `null` in the default
 * location. `undefined` means Git does not have that branch in any known
 * workspace, so Source Control may still switch in place.
 */
export function workspaceSlugForBranch(
  branch: string,
  gitWorkspaces: { path: string; branch: string | null }[] | undefined,
  root: LocationRoot,
  workspaces: { slug: string; localPath: string }[],
): string | null | undefined {
  const checkout = gitWorkspaces?.find((entry) => entry.branch === branch);
  if (!checkout) return undefined;
  const match = workspaces.find((entry) => sameLocalPath(entry.localPath, checkout.path));
  if (match) return match.slug;
  if (root.path && sameLocalPath(root.path, checkout.path)) return root.selector;
  return undefined;
}

export function projectRootBranch(
  gitWorkspaces: { path: string; branch: string | null }[] | undefined,
  rootPath: string,
  workspaces: { slug: string; localPath: string }[],
): string | null {
  if (!rootPath) return null;
  const root = gitWorkspaces?.find((entry) => {
    if (workspaces.some((workspace) => sameLocalPath(workspace.localPath, entry.path)))
      return false;
    return sameLocalPath(rootPath, entry.path);
  });
  return root?.branch ?? null;
}

/**
 * The key a terminal is kept under: the project and what it runs in, which is
 * a workspace's id or the selector of a root. No target at all is the root of
 * the default location.
 */
export function terminalSessionKey(projectId: string, target?: string | null): string {
  return `${projectId}:${target || "main"}`;
}

/**
 * What a listed terminal runs in, as the requests that reach it name it. A
 * workspace is named by its id. With no id it is a root, and which root is
 * said by the slug: `main@desktop` is the desktop's, and only a terminal that
 * names no location is taken to be in the default one.
 */
export function listedTerminalTarget(item: {
  workspaceId?: string;
  workspaceSlug?: string;
}): string | undefined {
  if (item.workspaceId) return item.workspaceId;
  return item.workspaceSlug && /^main@.+$/i.test(item.workspaceSlug)
    ? item.workspaceSlug.toLowerCase()
    : undefined;
}

export type ListedTerminal = {
  sessionId: string;
  projectId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  startedAt: number;
};
