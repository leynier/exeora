import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { keys } from "../../queries.js";
import { type Target, workspaceKeys } from "../../queries-workspace.js";
import type { Detail } from "./workspaceLayout.js";

/** How often the status, and the diff that is open, are read while the git client is on screen. */
export const AUTO_REFRESH_MS = 3_000;

export type AutoRefresh = {
  /** Whether the git client polls on its own. */
  auto: boolean;
  setAuto: (enabled: boolean) => void;
  /** A refresh asked for by hand is running. */
  refreshing: boolean;
  /** Read the status and the open diff again, now. */
  manual: () => Promise<void>;
  /**
   * Stop polling and drop whatever is in flight, before something changes the
   * checkout: a status read before the change must not land after it.
   */
  interrupt: () => Promise<void>;
  resume: () => void;
};

/**
 * Keeps the git client current without it asking.
 *
 * Every tick reads the status and, when a diff is open, that diff, in one
 * request each, and writes both into the cache together so the list and the
 * patch agree. A tick is skipped while the tab or side panel is hidden, and
 * whatever an action or a manual refresh finds in flight is thrown away: the
 * generation it was started under is gone.
 */
export function useAutoRefresh({
  target,
  enabled,
  selected,
  pending,
}: {
  target: Target;
  /** The git client is on screen and the machine can answer. */
  enabled: boolean;
  selected: Detail | null;
  /** An action is running, which owns the checkout until it is done. */
  pending: boolean;
}): AutoRefresh {
  const client = useQueryClient();
  const [auto, setAuto] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const paused = useRef(false);
  const { projectId, workspace, targetKey } = target;
  const diffPath = selected?.kind === "diff" ? selected.path : undefined;
  const diffArea = selected?.kind === "diff" ? selected.area : undefined;

  const interrupt = useCallback(async () => {
    paused.current = true;
    generation.current += 1;
    controller.current?.abort();
    await Promise.all([
      client.cancelQueries({ queryKey: keys.gitStatus(projectId, targetKey) }),
      client.cancelQueries({ queryKey: workspaceKeys.diffs(projectId, targetKey) }),
    ]);
  }, [client, projectId, targetKey]);

  const resume = useCallback(() => {
    paused.current = false;
  }, []);

  const manual = useCallback(async () => {
    if (paused.current) return;
    setRefreshing(true);
    try {
      await interrupt();
      await Promise.all([
        client.invalidateQueries(
          { queryKey: keys.gitStatus(projectId, targetKey) },
          { cancelRefetch: false },
        ),
        client.invalidateQueries(
          { queryKey: workspaceKeys.diffs(projectId, targetKey) },
          { cancelRefetch: false },
        ),
      ]);
    } finally {
      resume();
      setRefreshing(false);
    }
  }, [client, interrupt, projectId, resume, targetKey]);

  const poll = useCallback(async () => {
    const started = generation.current;
    const own = new AbortController();
    controller.current = own;
    try {
      const [status, diff] = await Promise.all([
        api.gitStatus(projectId, workspace, own.signal),
        diffPath && diffArea
          ? api.gitDiff(projectId, diffPath, diffArea, workspace, own.signal)
          : Promise.resolve(undefined),
      ]);
      if (own.signal.aborted || started !== generation.current) return;
      client.setQueryData(keys.gitStatus(projectId, targetKey), status);
      if (diff && diffPath && diffArea) {
        client.setQueryData(workspaceKeys.fileDiff(projectId, targetKey, diffPath, diffArea), diff);
      }
    } catch {
      // Keep the last known status and try again on the next visible tick.
    } finally {
      if (controller.current === own) controller.current = null;
    }
  }, [client, diffArea, diffPath, projectId, targetKey, workspace]);

  useEffect(() => {
    if (!enabled || !auto || pending || refreshing) return;
    let stopped = false;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        try {
          if (!stopped && !paused.current && document.visibilityState !== "hidden") await poll();
        } finally {
          if (!stopped) schedule();
        }
      }, AUTO_REFRESH_MS);
    };
    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [auto, enabled, pending, poll, refreshing]);

  return { auto, setAuto, refreshing, manual, interrupt, resume };
}
