import { IconButton, TreeView } from "@exeora/design/react";
import { Replace } from "lucide-react";
import { useMemo, useState } from "react";
import type { SearchResult } from "../../api-types-workspace.js";
import { requestLine } from "../../hooks/editorTargets.js";
import type { SearchInput } from "../../queries-workspace.js";
import { EmptyState } from "../ui.js";
import type { WorkspaceContext } from "../workspace/context.js";
import {
  allBranches,
  type SearchNode,
  searchList,
  searchTree,
  splitPreview,
} from "./searchModel.js";
import { useReplace } from "./useReplace.js";

/**
 * The hits, under their files, under their folders when asked. A hit opens
 * the file on its line; with replace showing, each row can be replaced on
 * its own and each file at once.
 */
export function SearchResults({
  ctx,
  input,
  result,
  tree,
  replacement,
  preserveCase,
}: {
  ctx: WorkspaceContext;
  input: SearchInput;
  result: SearchResult | undefined;
  tree: boolean;
  /** Null while replace is hidden. */
  replacement: string | null;
  preserveCase: boolean;
}) {
  const roots = useMemo(
    () => (result ? (tree ? searchTree(result.files) : searchList(result.files)) : []),
    [result, tree],
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const expanded = useMemo(
    () => new Set(allBranches(roots).filter((id) => !collapsed.has(id))),
    [roots, collapsed],
  );
  const replace = useReplace(ctx, input, { replacement: replacement ?? "", preserveCase });

  if (!result) {
    return (
      <EmptyState title="Search the workspace">
        Type to search every file of {ctx.targetLabel} on the machine that holds it.
      </EmptyState>
    );
  }
  if (result.files.length === 0) {
    return <EmptyState title="No results">Nothing in {ctx.targetLabel} matches.</EmptyState>;
  }

  const openMatch = (node: SearchNode, pin: boolean) => {
    if (node.kind !== "match") return;
    requestLine(node.path, node.match.line, node.match.column, node.match.length);
    ctx.open({ kind: "file", path: node.path }, pin);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <TreeView<SearchNode>
        label="Search results"
        roots={roots}
        expanded={expanded}
        indent={10}
        onToggle={(id, open) =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (open) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onSelect={(node) => openMatch(node.data, false)}
        onActivate={(node) => openMatch(node.data, true)}
        renderRow={(row) => {
          const data = row.node.data;
          if (data.kind === "dir") {
            return (
              <span className="text-foreground-muted flex min-w-0 flex-1 items-center gap-2 py-1 font-mono text-xs">
                <span className="min-w-0 truncate">{row.node.label}</span>
                <span className="text-foreground-faint ml-auto shrink-0 tabular-nums">
                  {data.count}
                </span>
              </span>
            );
          }
          if (data.kind === "file") {
            const blocked = ctx.dirtyPaths.has(data.path);
            return (
              <span className="group flex min-w-0 flex-1 items-center gap-2 py-1 font-mono text-xs">
                <span className="text-foreground min-w-0 truncate" title={data.path}>
                  {row.node.label}
                </span>
                <span className="text-foreground-faint ml-auto shrink-0 tabular-nums">
                  {data.file.matches.length}
                  {data.file.truncated ? "+" : ""}
                </span>
                {replacement !== null ? (
                  <IconButton
                    label={blocked ? "Save the open file first" : "Replace in this file"}
                    icon={Replace}
                    size="sm"
                    disabled={blocked || replace.pending || ctx.actions.pending}
                    className="invisible group-hover:visible group-focus-within:visible"
                    onClick={(event) => {
                      event.stopPropagation();
                      void replace.run([{ path: data.path, token: data.file.token }]);
                    }}
                  />
                ) : null}
              </span>
            );
          }
          const parts = splitPreview(data.match, replacement);
          const blocked = ctx.dirtyPaths.has(data.path);
          return (
            <span className="group flex min-w-0 flex-1 items-center gap-2 py-0.5 font-mono text-xs">
              <span className="text-foreground-faint w-8 shrink-0 text-right tabular-nums">
                {data.match.line}
              </span>
              <span className="min-w-0 flex-1 truncate whitespace-pre">
                <span className="text-foreground-muted">{parts.before}</span>
                <span
                  className={`rounded px-0.5 ${replacement !== null ? "bg-error/20 text-error line-through" : "bg-warning/20 text-foreground"}`}
                >
                  {parts.hit}
                </span>
                {replacement !== null ? (
                  <span className="bg-success/20 text-success rounded px-0.5">
                    {parts.replaced}
                  </span>
                ) : null}
                <span className="text-foreground-muted">{parts.after}</span>
              </span>
              {replacement !== null ? (
                <IconButton
                  label={blocked ? "Save the open file first" : "Replace this match"}
                  icon={Replace}
                  size="sm"
                  disabled={blocked || replace.pending || ctx.actions.pending}
                  className="invisible group-hover:visible group-focus-within:visible"
                  onClick={(event) => {
                    event.stopPropagation();
                    void replace.run([
                      { path: data.path, token: data.file.token, lines: [data.match.line] },
                    ]);
                  }}
                />
              ) : null}
            </span>
          );
        }}
      />
      {result.truncated ? (
        <p className="text-label-md text-warning px-3 py-1">
          Only the first matches are shown. Narrow the search to see the rest.
        </p>
      ) : null}
    </div>
  );
}
