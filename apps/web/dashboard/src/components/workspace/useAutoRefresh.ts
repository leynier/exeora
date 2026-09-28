import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import type { DiffArea } from "../../api-types-workspace.js";
import { workspaceRead } from "../../api-workspace.js";
import { keys } from "../../queries.js";
import { type Target, workspaceKeys } from "../../queries-workspace.js";
import type { Detail } from "./workspaceLayout.js";

/** How often the status, and the patch that is open, are read while the git client is on screen. */
export const AUTO_REFRESH_MS = 3_000;

export type AutoRefresh = {
  /** Whether the git client polls on its own. */
  auto: boolean;
  setAuto: (enabled: boolean) => void;
  /** A refresh asked for by hand is running. */
  refreshing: boolean;
  /** Read the status and the open patch again, now. */
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
 * Every tick reads the status and, when a patch is open (one file's diff, or
 * the whole tree's), that patch, in one request each, and writes both into
 * the cache together so the list and the patch agree. A tick is skipped
 * while the tab or side panel is hidden, and whatever an action or a manual
 * refresh finds in flight is thrown away: the generation it was started
 * under is gone.
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
  const patch = openPatch(selected);
  const patchKind = patch?.kind;
  const patchArea = patch?.area;
  const patchPath = patch?.kind === "diff" ? patch.path : undefined;

  const interrupt = useCallback(async () => {
    paused.current = true;
    generation.current += 1;
    controller.current?.abort();
    await Promise.all(
      patchKeys(projectId, targetKey).map((queryKey) => client.cancelQueries({ queryKey })),
    );
  }, [client, projectId, targetKey]);

  const resume = useCallback(() => {
    paused.current = false;
  }, []);

  const manual = useCallback(async () => {
    if (paused.current) return;
    setRefreshing(true);
    try {
      await interrupt();
      await Promise.all(
        patchKeys(projectId, targetKey).map((queryKey) =>
          client.invalidateQueries({ queryKey }, { cancelRefetch: false }),
        ),
      );
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
      const patchKey =
        patchKind === "diff" && patchPath && patchArea
          ? workspaceKeys.fileDiff(projectId, targetKey, patchPath, patchArea)
          : patchKind === "diffall" && patchArea
            ? workspaceKeys.diffAll(projectId, targetKey, patchArea)
            : null;
      const [status, value] = await Promise.all([
        api.gitStatus(projectId, workspace, own.signal),
        patchKind === "diff" && patchPath && patchArea
          ? api.gitDiff(projectId, patchPath, patchArea, workspace, own.signal)
          : patchKind === "diffall" && patchArea
            ? workspaceRead(
                projectId,
                { action: "diff_all", area: patchArea },
                workspace,
                own.signal,
              )
            : Promise.resolve(undefined),
      ]);
      if (own.signal.aborted || started !== generation.current) return;
      // A fetch of either that was already in flight, from a mount or a
      // focus, must not land after this pair and leave them disagreeing.
      const statusKey = keys.gitStatus(projectId, targetKey);
      await Promise.all(
        [statusKey, ...(patchKey ? [patchKey] : [])].map((queryKey) =>
          client.cancelQueries({ queryKey }),
        ),
      );
      if (own.signal.aborted || started !== generation.current) return;
      client.setQueryData(statusKey, status);
      if (value && patchKey) client.setQueryData(patchKey, value);
    } catch {
      // Keep the last known status and try again on the next visible tick.
    } finally {
      if (controller.current === own) controller.current = null;
    }
  }, [client, patchArea, patchKind, patchPath, projectId, targetKey, workspace]);

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

/** The patch on screen that a tick reads beside the status, if the open detail is one. */
function openPatch(
  selected: Detail | null,
): { kind: "diff"; area: DiffArea; path: string } | { kind: "diffall"; area: DiffArea } | null {
  if (selected?.kind === "diff") return { kind: "diff", area: selected.area, path: selected.path };
  if (selected?.kind === "diffall") return { kind: "diffall", area: selected.area };
  return null;
}

/** The status and every patch of the working copy: what a refresh covers. */
function patchKeys(projectId: string, targetKey: string) {
  return [
    keys.gitStatus(projectId, targetKey),
    workspaceKeys.diffs(projectId, targetKey),
    workspaceKeys.diffAlls(projectId, targetKey),
  ];
}
