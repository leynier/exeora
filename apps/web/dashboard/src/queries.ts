import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, type ToolCallFilters } from "./api.js";

/**
 * Every query the dashboard makes, defined once.
 *
 * Keys live here rather than inline so invalidation can name exactly what it
 * means: revoking a device changes devices and, through the relay, activity,
 * but it does not change who is signed in.
 */

export const keys = {
  me: ["me"] as const,
  devices: ["devices"] as const,
  projects: ["projects"] as const,
  clients: ["clients"] as const,

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

/** Presence goes stale on its own, so it is polled rather than left to a reload. */
const LIVE = 15_000;

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });

export const useDevices = () =>
  useQuery({ queryKey: keys.devices, queryFn: api.devices, refetchInterval: LIVE });

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });

/** Polled too: "last used" is the only sign a client is still talking to us. */
export const useClients = () =>
  useQuery({ queryKey: keys.clients, queryFn: api.clients, refetchInterval: LIVE });

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
