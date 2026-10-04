import { IconButton } from "@exeora/design/react";
import {
  CaseSensitive,
  Eye,
  EyeOff,
  List,
  ListTree,
  Regex,
  Replace,
  SlidersHorizontal,
  WholeWord,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { type SearchInput, useSearch } from "../../queries-workspace.js";
import { ErrorBanner } from "../ui.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { workspacePrefs } from "../workspace/workspacePrefs.js";
import { ReplaceBar } from "./ReplaceBar.js";
import { SearchResults } from "./SearchResults.js";
import { summary } from "./searchModel.js";
import {
  type SearchState,
  searchFromParams,
  searchStore,
  useSearchState,
  withoutSearchParams,
} from "./searchStore.js";

/** A keystroke's grace before the machine is asked. */
const DEBOUNCE_MS = 250;

const toggleClass = "border-border bg-bg flex items-center gap-0.5 rounded-lg border px-1";

/**
 * Search across the checkout, as one types.
 *
 * The query and its switches go to the machine after a short pause, the
 * previous answer stays up while the next is on its way, and what comes back
 * is grouped by file. Replace lives under the query, one match, one file or
 * everything at a time.
 */
export function SearchPanel({ ctx }: { ctx: WorkspaceContext }) {
  // Held outside the view, so a search asked for elsewhere shows up here.
  const [state, set] = useSearchState(ctx.target.projectId, ctx.target.targetKey);
  const { query, regex, caseSensitive, wholeWord, include, exclude, includeIgnored } = state;
  const setQuery = (value: string) => set("query", value);
  const setRegex = (value: (current: boolean) => boolean) => set("regex", value);
  const setCaseSensitive = (value: (current: boolean) => boolean) => set("caseSensitive", value);
  const setWholeWord = (value: (current: boolean) => boolean) => set("wholeWord", value);
  const setInclude = (value: string) => set("include", value);
  const setExclude = (value: string) => set("exclude", value);
  const setIncludeIgnored = (value: (current: boolean) => boolean) => set("includeIgnored", value);
  // A search the address carries (a link, a navigation) becomes this view's.
  const [params, setParams] = useSearchParams();
  const asked = searchFromParams(params);
  const askedKey = asked ? JSON.stringify(asked) : null;
  const { projectId, targetKey } = ctx.target;
  useEffect(() => {
    if (!askedKey) return;
    searchStore.update(projectId, targetKey, JSON.parse(askedKey) as SearchState);
    setParams((current) => withoutSearchParams(current), { replace: true });
  }, [askedKey, projectId, targetKey, setParams]);
  const [details, setDetails] = useState(Boolean(include || exclude));
  // Filters set from outside the view are shown, not left folded away.
  useEffect(() => {
    if (include || exclude) setDetails(true);
  }, [include, exclude]);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [preserveCase, setPreserveCase] = useState(false);
  const [tree, setTree] = useState(workspacePrefs.searchTree.read);
  const debounced = useDebounced(query, DEBOUNCE_MS);

  const input: SearchInput = useMemo(
    () => ({
      query: debounced.trim(),
      regex,
      caseSensitive,
      wholeWord,
      ...(include.trim() ? { include: include.trim() } : {}),
      ...(exclude.trim() ? { exclude: exclude.trim() } : {}),
      includeIgnored,
    }),
    [debounced, regex, caseSensitive, wholeWord, include, exclude, includeIgnored],
  );
  const search = useSearch(ctx.target, input, true);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-border-subtle shrink-0 space-y-2 border-b p-2">
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search"
              autoComplete="off"
              spellCheck={false}
              className="border-border bg-bg w-full rounded-lg border py-1.5 pr-7 pl-3 font-mono text-xs"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                className="text-foreground-faint hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className={toggleClass}>
            <IconButton
              label="Match case"
              icon={CaseSensitive}
              size="sm"
              pressed={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
            />
            <IconButton
              label="Match whole word"
              icon={WholeWord}
              size="sm"
              pressed={wholeWord}
              onClick={() => setWholeWord((v) => !v)}
            />
            <IconButton
              label="Use regular expression"
              icon={Regex}
              size="sm"
              pressed={regex}
              onClick={() => setRegex((v) => !v)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-1">
          <p className="text-label-md text-foreground-faint min-w-0 truncate px-1">
            {summary(search.data, search.isFetching)}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={replacing ? "Hide replace" : "Show replace"}
              icon={Replace}
              size="sm"
              pressed={replacing}
              onClick={() => setReplacing((v) => !v)}
            />
            <IconButton
              label={details ? "Hide details" : "Show details"}
              icon={SlidersHorizontal}
              size="sm"
              pressed={details}
              onClick={() => setDetails((v) => !v)}
            />
            <IconButton
              label={includeIgnored ? "Skip ignored files" : "Search ignored files too"}
              icon={includeIgnored ? EyeOff : Eye}
              size="sm"
              pressed={includeIgnored}
              onClick={() => setIncludeIgnored((v) => !v)}
            />
            <IconButton
              label={tree ? "View as list" : "View as tree"}
              icon={tree ? List : ListTree}
              size="sm"
              onClick={() => setTree(workspacePrefs.searchTree.write(!tree))}
            />
          </div>
        </div>
        {details ? (
          <div className="grid grid-cols-2 gap-1">
            <input
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              placeholder="Files to include, e.g. src/**"
              aria-label="Files to include"
              autoComplete="off"
              spellCheck={false}
              className="border-border bg-bg min-w-0 rounded-lg border px-2 py-1 font-mono text-xs"
            />
            <input
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              placeholder="Files to exclude"
              aria-label="Files to exclude"
              autoComplete="off"
              spellCheck={false}
              className="border-border bg-bg min-w-0 rounded-lg border px-2 py-1 font-mono text-xs"
            />
          </div>
        ) : null}
        {replacing ? (
          <ReplaceBar
            ctx={ctx}
            input={input}
            result={search.data}
            replacement={replacement}
            preserveCase={preserveCase}
            onReplacementChange={setReplacement}
            onPreserveCaseChange={setPreserveCase}
          />
        ) : null}
      </header>
      {search.isError ? (
        <div className="p-3">
          <ErrorBanner error={search.error} onRetry={() => void search.refetch()} />
        </div>
      ) : (
        <SearchResults
          ctx={ctx}
          input={input}
          result={search.data}
          tree={tree}
          replacement={replacing ? replacement : null}
          preserveCase={preserveCase}
        />
      )}
    </div>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
