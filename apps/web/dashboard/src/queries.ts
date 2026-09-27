import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { api, type ToolCallFilters, type Workspace } from "./api.js";
import { type Machine, projectsApi } from "./api-projects.js";

/**
 * Every query the dashboard makes, defined once.
 *
 * Keys live here rather than inline so invalidation can name exactly what it
 * means: revoking a machine changes machines and, through the relay, activity,
 * but it does not change who is signed in.
 */

export const keys = {
  me: ["me"] as const,
  /** Every machine query at once, with and without the provider's word. */
  machines: ["machines"] as const,
  machineList: (live: boolean) => ["machines", live ? "live" : "stored"] as const,
  projects: ["projects"] as const,
  workspaces: (projectId: string) => ["projects", projectId, "workspaces"] as const,
  workspaceCapabilities: (id: string, target: string) =>
    ["workspace", id, target, "capabilities"] as const,
  gitStatus: (id: string, target: string) => ["workspace", id, target, "status"] as const,
  terminals: ["terminals"] as const,
  clients: ["clients"] as const,
  accountClients: ["account-clients"] as const,
  approvals: ["approvals"] as const,
  github: ["github"] as const,
  githubStatus: ["github", "status"] as const,
  githubRepositories: (query: string) => ["github", "repositories", query] as const,
  adminOverview: ["admin", "overview"] as const,
  adminUsers: ["admin", "users"] as const,
  adminUser: (id: string) => ["admin", "users", id] as const,

  /**
   * Every audit query at once. React Query matches keys by prefix, so this
   * covers both shapes below and all their filters, which is what a revocation
   * wants: it changes the log, and there is no telling which view is open.
   */
  allCalls: ["calls"] as const,

  /**
   * The filters are part of the key because the server applies them: two
   * filters are two different result sets rather than one set viewed two ways,
   * and sharing a key would show the previous filter's rows for a frame every
   * time someone changes their mind.
   *
   * The two shapes are kept apart because an infinite query caches
   * `{ pages, pageParams }` where a plain one caches a page. One key for both
   * would hand each the other's data.
   */
  calls: (filters: ToolCallFilters = {}) => ["calls", "page", filters] as const,
  callPages: (filters: ToolCallFilters = {}) => ["calls", "pages", filters] as const,
};

/**
 * What changes when a project, a location, a workspace or a machine is added
 * or removed: the projects with their locations, every machine, the plan's
 * usage and, when a project is named, its workspaces.
 *
 * `exact` on the projects, because their key is a prefix of every project's
 * workspaces: without it one removal would refetch the workspaces of every
 * project that happens to be cached.
 */
export function refreshPlaces(client: QueryClient, projectId?: string): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.projects, exact: true }),
    client.invalidateQueries({ queryKey: keys.machines }),
    client.invalidateQueries({ queryKey: keys.me }),
    projectId ? client.invalidateQueries({ queryKey: keys.workspaces(projectId) }) : null,
  ]);
}

/** Presence goes stale on its own, so it is polled rather than left to a reload. */
const LIVE = 15_000;

/**
 * A pending approval has an AI client waiting on the other side of it, and it
 * expires in ninety seconds, so fifteen would spend a fifth of its life not
 * knowing it exists.
 */
const URGENT = 3_000;

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });

/**
 * Admin queries stay quiet until `/api/me` confirms the allow-list. That keeps
 * ordinary accounts from firing requests that the server would 404, and keeps
 * the nav from flashing an Admin link that never loads.
 */
export const useAdminOverview = () => {
  const me = useMe();
  return useQuery({
    queryKey: keys.adminOverview,
    queryFn: api.adminOverview,
    enabled: me.data?.isAdmin === true,
  });
};

export const useAdminUsers = () => {
  const me = useMe();
  return useQuery({
    queryKey: keys.adminUsers,
    queryFn: api.adminUsers,
    enabled: me.data?.isAdmin === true,
  });
};

export const useAdminUser = (id: string) => {
  const me = useMe();
  return useQuery({
    queryKey: keys.adminUser(id),
    queryFn: () => api.adminUser(id),
    enabled: me.data?.isAdmin === true && id.length > 0,
  });
};

/** Whether something is still on its way, which is when somebody is watching it. */
export function machinesInFlight(machines: readonly Machine[]): boolean {
  return machines.some((machine) => machine.state === "setting up" || machine.state === "removing");
}

/**
 * Every machine that runs for the account: the person's own, and the instances
 * of Exeora Cloud.
 *
 * One list for both lenses, so an instance is in the same state on the project
 * page as on the Machines page. Polled fast while an instance is being set up
 * or removed and at the presence cadence otherwise. `live` is kept under a key
 * of its own, because it is a different answer: it carries what the provider
 * says, and costs a request to the provider to get.
 */
export const useMachines = (live = false) =>
  useQuery({
    queryKey: keys.machineList(live),
    queryFn: () => projectsApi.machines(live),
    select: (page) => page.machines,
    refetchInterval: (query) =>
      query.state.data && machinesInFlight(query.state.data.machines) ? URGENT : LIVE,
  });

/** Polled: a project on Exeora Cloud leaves the list only once its instances are gone. */
export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: api.projects, refetchInterval: LIVE });

/**
 * Whether GitHub is set up on this gateway and connected to this account.
 *
 * Not polled: it changes when the person leaves for github.com and comes back,
 * which is a page load. A gateway that predates GitHub answers 404, and the
 * pages that ask treat no answer as not enabled rather than as a failure.
 */
export const useGitHub = () =>
  useQuery({ queryKey: keys.githubStatus, queryFn: projectsApi.github, staleTime: 60_000 });

/**
 * The repositories a connected account can pick from, narrowed by the server.
 *
 * The previous answer stays on screen while the next one is fetched, so the
 * list does not blink to empty between two keystrokes.
 */
export const useGitHubRepositories = (query: string, enabled = true) =>
  useQuery({
    queryKey: keys.githubRepositories(query),
    queryFn: () => projectsApi.githubRepositories(query),
    select: (page) => page.repositories,
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const useWorkspaces = (projectId: string | undefined) =>
  useQuery({
    queryKey: keys.workspaces(projectId ?? ""),
    queryFn: () => api.workspaces(projectId ?? ""),
    enabled: Boolean(projectId),
    refetchInterval: LIVE,
  });

/**
 * The workspaces of several projects at once, by project.
 *
 * For a list that spans projects and has to say where each row ran. Each
 * project is the same query `useWorkspaces` makes, under the same key, so a
 * project already looked at costs nothing and one request serves every row of
 * that project. Not polled: the rows are history, and what a workspace was
 * called an hour ago is not worth asking again every fifteen seconds.
 */
export const useWorkspacesOf = (projectIds: readonly string[]) =>
  useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: keys.workspaces(projectId),
      queryFn: () => api.workspaces(projectId),
      staleTime: LIVE,
    })),
    combine: (results) =>
      new Map<string, Workspace[]>(
        projectIds.map((projectId, index) => [projectId, results[index]?.data ?? []]),
      ),
  });

export const useWorkspaceCapabilities = (
  id: string,
  workspace: string | undefined,
  enabled = true,
) => {
  const target = workspace ?? "main";
  return useQuery({
    queryKey: keys.workspaceCapabilities(id, target),
    queryFn: () => api.workspaceCapabilities(id, workspace),
    enabled: enabled && id.length > 0,
    refetchInterval: LIVE,
  });
};

export const useGitStatus = (
  id: string,
  workspace: string | undefined,
  enabled = true,
  live = true,
) => {
  const target = workspace ?? "main";
  return useQuery({
    queryKey: keys.gitStatus(id, target),
    queryFn: () => api.gitStatus(id, workspace),
    enabled: enabled && id.length > 0,
    refetchInterval: live ? LIVE : false,
  });
};

export const useOpenTerminals = () =>
  useQuery({ queryKey: keys.terminals, queryFn: api.terminals, refetchInterval: LIVE });

/** Polled too: "last used" is the only sign a client is still talking to us. */
export const useClients = () =>
  useQuery({ queryKey: keys.clients, queryFn: api.clients, refetchInterval: LIVE });

/**
 * The same clients seen through the account URL, grouped one row each.
 *
 * A separate query rather than a regrouping of `useClients`, because the server
 * folds one account connection across all of its project rows.
 */
export const useAccountClients = () =>
  useQuery({
    queryKey: keys.accountClients,
    queryFn: api.accountClients,
    refetchInterval: LIVE,
  });

/**
 * Calls waiting on someone to confirm them.
 *
 * Polled fast, and only while the tab is in front of someone: a question nobody
 * is looking at is one the terminal or the deadline will settle, and polling
 * every three seconds from a tab left open for a week would be work spent on
 * nothing. `refetchIntervalInBackground` defaults to false, which is exactly
 * that behaviour, and is named here because it is load bearing rather than
 * incidental.
 */
export const useApprovals = () =>
  useQuery({
    queryKey: keys.approvals,
    queryFn: api.approvals,
    select: (page) => page.items,
    refetchInterval: URGENT,
    refetchIntervalInBackground: false,
  });

/**
 * The most recent page of the audit log, for the places that want a glance at
 * it rather than the whole thing: the overview's summary and a project's own
 * recent activity.
 */
export const useToolCalls = (filters: ToolCallFilters = {}) =>
  useQuery({
    queryKey: keys.calls(filters),
    queryFn: () => api.toolCalls(filters),
    select: (page) => page.items,
    refetchInterval: LIVE,
  });

/**
 * The audit log page by page, for the Activity screen.
 *
 * Not polled, unlike the single-page reads above. A refetch of an infinite
 * query re-fetches every page already loaded, which for someone who has paged
 * back through weeks of history is a great deal of work to do every fifteen
 * seconds without being asked.
 */
export const useToolCallPages = (filters: ToolCallFilters = {}) =>
  useInfiniteQuery({
    queryKey: keys.callPages(filters),
    queryFn: ({ pageParam }) => api.toolCalls(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.cursor ?? undefined,
  });
