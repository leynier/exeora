import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitStatus } from "../../api.js";
import {
  closeTab,
  type Detail,
  encodeDetail,
  keepTabs,
  NO_TABS,
  type OpenTabs,
  openTab,
  parseDetail,
  pinTab,
  readTabs,
  setTabDirty,
  writeTabs,
} from "./workspaceLayout.js";

/**
 * Where a detail goes when it is opened.
 *
 * On a wide screen it is a tab in the main area, remembered per working copy
 * for the length of the browser session. On a narrow one it is pushed into
 * the address, so the shell shows it over the list and Back returns.
 */
export function useOpener({
  wide,
  targetKey,
  search,
  setSearch,
  status,
  isDirty,
  hold = false,
}: {
  wide: boolean;
  /** Leave a detail in the address for now: there is nowhere to open it yet. */
  hold?: boolean;
  /** Where the tabs are remembered. */
  targetKey: string;
  /** Whether a file has edits waiting elsewhere, for tabs read back from storage. */
  isDirty?: (path: string) => boolean;
  search: URLSearchParams;
  setSearch: (params: URLSearchParams, options?: { replace?: boolean }) => void;
  status: GitStatus | undefined;
}) {
  const [tabs, setTabs] = useState<OpenTabs>(NO_TABS);
  const detailParam = search.get("detail");
  const detail = useMemo(() => parseDetail(detailParam), [detailParam]);

  // Asked when the tabs are read back, once per working copy.
  const dirtyCheck = useRef(isDirty);
  dirtyCheck.current = isDirty;

  useEffect(() => {
    const read = readTabs(sessionStorage, targetKey);
    setTabs({
      ...read,
      tabs: read.tabs.map((tab) =>
        tab.detail.kind === "file" && dirtyCheck.current?.(tab.detail.path)
          ? { ...tab, dirty: true }
          : tab,
      ),
    });
  }, [targetKey]);

  useEffect(() => {
    writeTabs(sessionStorage, targetKey, tabs);
  }, [tabs, targetKey]);

  // A link that names a detail lands on a wide screen too: it opens as a
  // pinned tab, and the address goes back to naming only the view.
  // The router's own address, not the window's: in a side panel or a ChatGPT
  // frame the router lives in memory and the window's says nothing.
  useEffect(() => {
    if (!wide || !detail || hold) return;
    setTabs((current) => openTab(current, detail, true));
    const params = new URLSearchParams(search);
    params.delete("detail");
    setSearch(params, { replace: true });
  }, [wide, detail, hold, search, setSearch]);

  // A diff of a file that is clean now has nothing left to show.
  useEffect(() => {
    if (!status) return;
    setTabs((current) =>
      keepTabs(current, (tab) => {
        if (tab.detail.kind !== "diff") return true;
        const { path, area } = tab.detail;
        const file = status.files.find((item) => item.path === path);
        if (!file) return false;
        return area === "staged"
          ? file.index !== "." && file.index !== "?"
          : file.worktree !== "." || file.kind === "untracked";
      }),
    );
  }, [status]);

  const open = useCallback(
    (next: Detail, pin = false) => {
      if (wide) {
        setTabs((current) => openTab(current, next, pin));
        return;
      }
      const params = new URLSearchParams(search);
      params.set("detail", encodeDetail(next));
      // Replacing one detail with another keeps Back pointing at the list.
      setSearch(params, { replace: search.has("detail") });
    },
    [wide, search, setSearch],
  );

  const setDirty = useCallback((target: Detail, dirty: boolean) => {
    setTabs((current) => setTabDirty(current, encodeDetail(target), dirty));
  }, []);

  const dirtyPaths = useMemo(
    () =>
      new Set(
        tabs.tabs
          .filter((tab) => tab.dirty && tab.detail.kind === "file")
          .map((tab) => (tab.detail.kind === "file" ? tab.detail.path : "")),
      ),
    [tabs],
  );

  const active = tabs.tabs.find((tab) => tab.id === tabs.active) ?? null;
  const selected: Detail | null = wide ? (active?.detail ?? null) : detail;

  return {
    tabs,
    detail,
    selected,
    open,
    activate: (id: string) => setTabs((current) => ({ ...current, active: id })),
    close: (id: string) => setTabs((current) => closeTab(current, id)),
    pin: (id: string) => setTabs((current) => pinTab(current, id)),
    setDirty,
    dirtyPaths,
  };
}
