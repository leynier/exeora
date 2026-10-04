import { useCallback, useSyncExternalStore } from "react";
import { targetScopedKey } from "../workspace/scope.js";

/**
 * The search a working copy is showing: what is typed and its switches.
 *
 * The Search view reads and writes it here rather than holding it, so
 * something outside the view (a navigation asked for by ChatGPT) can set a
 * query and the view shows it, results and all, as if typed. It lives as long
 * as the page, per project and working copy (and per panel when embedded).
 */

export interface SearchState {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
  exclude: string;
  includeIgnored: boolean;
}

export const EMPTY_SEARCH: SearchState = {
  query: "",
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  include: "",
  exclude: "",
  includeIgnored: false,
};

const states = new Map<string, SearchState>();
const listeners = new Map<string, Set<() => void>>();

function key(projectId: string, targetKey: string): string {
  return targetScopedKey(projectId, targetKey, "search");
}

export const searchStore = {
  get: (projectId: string, targetKey: string): SearchState =>
    states.get(key(projectId, targetKey)) ?? EMPTY_SEARCH,
  /** Changes what is given and keeps the rest. */
  update: (projectId: string, targetKey: string, patch: Partial<SearchState>): void => {
    const id = key(projectId, targetKey);
    const current = states.get(id) ?? EMPTY_SEARCH;
    const next = { ...current, ...patch };
    if (sameSearch(current, next)) return;
    states.set(id, next);
    for (const listener of listeners.get(id) ?? []) listener();
  },
  /** Forgets every search: signing out leaves nothing for the next account. */
  clearAll: (): void => {
    states.clear();
    for (const set of listeners.values()) for (const listener of set) listener();
  },
  subscribe: (projectId: string, targetKey: string, listener: () => void): (() => void) => {
    const id = key(projectId, targetKey);
    const set = listeners.get(id) ?? new Set();
    set.add(listener);
    listeners.set(id, set);
    return () => {
      set.delete(listener);
    };
  },
};

export function sameSearch(a: SearchState, b: SearchState): boolean {
  return (Object.keys(EMPTY_SEARCH) as (keyof SearchState)[]).every((name) => a[name] === b[name]);
}

/** One working copy's search, and a setter shaped like `useState`'s per field. */
export function useSearchState(projectId: string, targetKey: string) {
  const state = useSyncExternalStore(
    useCallback(
      (listener: () => void) => searchStore.subscribe(projectId, targetKey, listener),
      [projectId, targetKey],
    ),
    () => searchStore.get(projectId, targetKey),
  );
  const set = useCallback(
    <Name extends keyof SearchState>(
      name: Name,
      value: SearchState[Name] | ((current: SearchState[Name]) => SearchState[Name]),
    ) => {
      const current = searchStore.get(projectId, targetKey)[name];
      const next =
        typeof value === "function"
          ? (value as (current: SearchState[Name]) => SearchState[Name])(current)
          : value;
      searchStore.update(projectId, targetKey, { [name]: next } as Partial<SearchState>);
    },
    [projectId, targetKey],
  );
  return [state, set] as const;
}

/**
 * A search carried by the address (`?q=` and its switches): what a link or a
 * navigation asks the Search view to show. The view takes it into the store
 * of the working copy it shows, then drops it from the address, so going
 * back and forth does not run it again. `q` present, even empty, is a search.
 */
const PARAMS = {
  query: "q",
  regex: "regex",
  caseSensitive: "case",
  wholeWord: "word",
  include: "include",
  exclude: "exclude",
  includeIgnored: "ignored",
} as const satisfies Record<keyof SearchState, string>;

export function searchToParams(search: SearchState, params: URLSearchParams): void {
  for (const [name, param] of Object.entries(PARAMS) as [keyof SearchState, string][]) {
    const value = search[name];
    if (typeof value === "boolean") {
      if (value) params.set(param, "1");
    } else if (name === "query" || value) {
      params.set(param, value);
    }
  }
}

/** The whole search the address names, or null when it names none. */
export function searchFromParams(params: URLSearchParams): SearchState | null {
  if (!params.has(PARAMS.query)) return null;
  const flag = (param: string) => params.get(param) === "1";
  return {
    query: params.get(PARAMS.query) ?? "",
    regex: flag(PARAMS.regex),
    caseSensitive: flag(PARAMS.caseSensitive),
    wholeWord: flag(PARAMS.wholeWord),
    include: params.get(PARAMS.include) ?? "",
    exclude: params.get(PARAMS.exclude) ?? "",
    includeIgnored: flag(PARAMS.includeIgnored),
  };
}

export function withoutSearchParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const param of Object.values(PARAMS)) next.delete(param);
  return next;
}
