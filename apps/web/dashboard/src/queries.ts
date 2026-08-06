import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

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
  calls: ["calls"] as const,
};

/** Presence goes stale on its own, so it is polled rather than left to a reload. */
const LIVE = 15_000;

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });

export const useDevices = () =>
  useQuery({ queryKey: keys.devices, queryFn: api.devices, refetchInterval: LIVE });

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });

export const useToolCalls = () =>
  useQuery({ queryKey: keys.calls, queryFn: () => api.toolCalls(), refetchInterval: LIVE });
