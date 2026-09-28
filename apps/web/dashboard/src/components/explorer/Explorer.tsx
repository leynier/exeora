import {
  ContextMenu,
  FileIcon,
  IconButton,
  isWithin,
  type MenuEntry,
  TreeView,
} from "@exeora/design/react";
import { useQueries } from "@tanstack/react-query";
import {
  ChevronsDownUp,
  Copy,
  Eye,
  EyeOff,
  FileDiff,
  FilePlus,
  FolderInput,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkspaceAction } from "../../api.js";
import type { FileTreeEntry } from "../../api-types-workspace.js";
import { workspaceRead } from "../../api-workspace.js";
import { workspaceKeys } from "../../queries-workspace.js";
import { useToast } from "../toast.js";
import { ErrorBanner } from "../ui.js";
import { fileStatusClass } from "../WorkspaceFileGroup.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { workspacePrefs } from "../workspace/workspacePrefs.js";
import { ExplorerDialogs, type NameRequest } from "./ExplorerDialogs.js";
import {
  baseName,
  buildTree,
  type ExplorerNode,
  joinPath,
  parentOf,
  statusLetters,
} from "./explorerModel.js";

/**
 * The files of the checkout, a directory at a time.
 *
 * Only the root and the folders that are open are listed, each its own
 * query, so a repository with a node_modules somewhere costs nothing until
 * that folder is opened. What git says about a path is drawn beside it, and
 * on the folders above it.
 */
export function Explorer({ ctx }: { ctx: WorkspaceContext }) {
  const { target, actions } = ctx;
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(workspacePrefs.expanded.read(ctx.project.id)),
  );
  const [showIgnored, setShowIgnored] = useState(workspacePrefs.showIgnored.read);
  const [naming, setNaming] = useState<NameRequest | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const directories = useMemo(() => [".", ...expanded], [expanded]);
  const listings = useQueries({
    queries: directories.map((path) => ({
      queryKey: workspaceKeys.tree(target.projectId, target.targetKey, path, showIgnored),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        workspaceRead(
          target.projectId,
          { action: "tree", path, showIgnored },
          target.workspace,
          signal,
        ),
    })),
  });
  const byPath = useMemo(() => {
    const map = new Map<string, readonly FileTreeEntry[] | undefined>();
    directories.forEach((path, index) => {
      map.set(path, listings[index]?.data?.entries);
    });
    return map;
  }, [directories, listings]);
  const letters = useMemo(() => statusLetters(ctx.status.data?.files ?? []), [ctx.status.data]);
  const roots = useMemo(() => buildTree(byPath, letters), [byPath, letters]);
  const known = useMemo(
    () => [
      ".",
      ...[...byPath.values()]
        .flat()
        .filter((e) => e?.type === "directory")
        .map((e) => e?.path ?? ""),
    ],
    [byPath],
  );
  const root = listings[0];
  const loading = listings.some((query) => query.isFetching);

  const setOpen = (id: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else for (const path of next) if (isWithin(id, path)) next.delete(path);
      workspacePrefs.expanded.write(ctx.project.id, [...next]);
      return next;
    });
  };

  const run = (action: WorkspaceAction) => actions.run(action);

  const create = async (request: NameRequest, name: string) => {
    if (request.kind === "rename") {
      const to = joinPath(parentOf(request.path), name);
      const result = await run({ action: "file_rename", from: request.path, to });
      if (result) setNaming(null);
      return;
    }
    const path = joinPath(request.dir, name);
    const result = await run({ action: "file_create", path, type: request.type });
    if (!result) return;
    setNaming(null);
    if (request.dir !== ".") setOpen(request.dir, true);
    if (request.type === "file") ctx.open({ kind: "file", path }, true);
  };

  const move = async (path: string, to: string) => {
    const result = await run({ action: "file_move", paths: [path], to });
    if (result) setMoving(null);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Path copied.");
    } catch {
      toast("Could not copy the path.", "error");
    }
  };

  const entriesFor = (entry: FileTreeEntry): MenuEntry[] => {
    const dir = entry.type === "directory" ? entry.path : parentOf(entry.path);
    const changed = letters.has(entry.path) && entry.type !== "directory";
    const list: MenuEntry[] = [
      {
        label: "New file",
        icon: FilePlus,
        onSelect: () => setNaming({ kind: "create", type: "file", dir }),
      },
      {
        label: "New folder",
        icon: FolderPlus,
        onSelect: () => setNaming({ kind: "create", type: "directory", dir }),
      },
      { separator: true },
      {
        label: "Rename",
        icon: Pencil,
        onSelect: () => setNaming({ kind: "rename", path: entry.path }),
      },
      { label: "Move to…", icon: FolderInput, onSelect: () => setMoving(entry.path) },
      {
        label: "Duplicate",
        icon: Copy,
        onSelect: () => void run({ action: "file_duplicate", path: entry.path }),
      },
      { separator: true },
      { label: "Copy relative path", icon: Copy, onSelect: () => void copy(entry.path) },
      {
        label: "Copy absolute path",
        icon: Copy,
        disabled: !ctx.rootPath,
        reason: "The machine's path is not known here",
        onSelect: () => void copy(`${ctx.rootPath.replace(/\/$/, "")}/${entry.path}`),
      },
    ];
    if (changed) {
      list.push({ separator: true });
      list.push({
        label: "View diff",
        icon: FileDiff,
        onSelect: () => ctx.open({ kind: "diff", area: "working", path: entry.path }, true),
      });
    }
    list.push({ separator: true });
    list.push({
      label: "Delete",
      icon: Trash,
      danger: true,
      onSelect: () =>
        actions.setConfirm({
          action: { action: "file_delete", paths: [entry.path] },
          title: entry.type === "directory" ? "Delete this folder?" : "Delete this file?",
          body: `${entry.path} will be permanently deleted from the machine that holds this workspace. There is no trash to recover it from.`,
          label: "Delete",
        }),
    });
    return list.map((item) =>
      item.separator ? item : { ...item, disabled: item.disabled || actions.pending },
    );
  };

  const rootEntries: MenuEntry[] = [
    {
      label: "New file",
      icon: FilePlus,
      onSelect: () => setNaming({ kind: "create", type: "file", dir: "." }),
    },
    {
      label: "New folder",
      icon: FolderPlus,
      onSelect: () => setNaming({ kind: "create", type: "directory", dir: "." }),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-border-subtle flex shrink-0 items-center justify-between gap-1 border-b px-2 py-1">
        <h2 className="text-label-md text-foreground-faint truncate px-1 font-mono tracking-wide uppercase">
          Explorer
        </h2>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="New file"
            icon={FilePlus}
            size="sm"
            disabled={actions.pending}
            onClick={() => setNaming({ kind: "create", type: "file", dir: "." })}
          />
          <IconButton
            label="New folder"
            icon={FolderPlus}
            size="sm"
            disabled={actions.pending}
            onClick={() => setNaming({ kind: "create", type: "directory", dir: "." })}
          />
          <IconButton
            label={showIgnored ? "Hide ignored files" : "Show ignored files"}
            icon={showIgnored ? EyeOff : Eye}
            size="sm"
            pressed={showIgnored}
            onClick={() => setShowIgnored(workspacePrefs.showIgnored.write(!showIgnored))}
          />
          <IconButton
            label="Collapse all"
            icon={ChevronsDownUp}
            size="sm"
            disabled={expanded.size === 0}
            onClick={() => {
              setExpanded(new Set());
              workspacePrefs.expanded.write(ctx.project.id, []);
            }}
          />
          <IconButton
            label="Refresh"
            icon={RefreshCw}
            size="sm"
            busy={loading}
            onClick={() => {
              for (const query of listings) void query.refetch();
            }}
          />
        </div>
      </header>
      <ContextMenu label="Explorer actions" entries={rootEntries} disabled={actions.pending}>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {root?.isError ? (
            <ErrorBanner error={root.error} onRetry={() => void root.refetch()} />
          ) : (
            <TreeView<ExplorerNode>
              label="Files"
              roots={roots}
              expanded={expanded}
              selectedId={ctx.selected?.kind === "file" ? ctx.selected.path : null}
              onToggle={setOpen}
              onSelect={(node) => {
                if (node.data.entry.type !== "directory") ctx.open({ kind: "file", path: node.id });
              }}
              onActivate={(node) => {
                if (node.data.entry.type !== "directory")
                  ctx.open({ kind: "file", path: node.id }, true);
              }}
              drag={{
                canDrag: () => !actions.pending,
                canDrop: (source, over) =>
                  over.data.entry.type === "directory" &&
                  !isWithin(source.id, over.id) &&
                  parentOf(source.id) !== over.id,
                onDrop: (source, over) =>
                  void run({ action: "file_move", paths: [source.id], to: over.id }),
              }}
              menu={{
                label: (node) => `Actions for ${node.data.entry.path}`,
                entries: (node) => entriesFor(node.data.entry),
              }}
              renderRow={(row) => {
                const { entry, status } = row.node.data;
                return (
                  <span
                    className={`flex min-w-0 flex-1 items-center gap-2 py-1 font-mono text-xs ${
                      entry.ignored ? "text-foreground-faint" : "text-foreground"
                    }`}
                    title={entry.path}
                  >
                    <FileIcon
                      name={entry.name}
                      kind={entry.type === "directory" ? "directory" : "file"}
                      open={row.expanded}
                      className={entry.ignored ? "opacity-60" : ""}
                    />
                    <span className="min-w-0 truncate">{row.node.label}</span>
                    {status ? (
                      <span
                        className={`ml-auto shrink-0 pr-1 font-medium ${fileStatusClass(status, status === "U" ? "untracked" : "tracked")}`}
                      >
                        {status}
                      </span>
                    ) : null}
                  </span>
                );
              }}
            />
          )}
          {root?.data?.truncated ? (
            <p className="text-label-md text-warning px-3 py-1">
              Only the first entries of a very large folder are listed.
            </p>
          ) : null}
        </div>
      </ContextMenu>
      <ExplorerDialogs
        naming={naming}
        moving={moving}
        directories={known}
        pending={actions.pending}
        onName={(request, name) => void create(request, name)}
        onMove={(path, to) => void move(path, to)}
        onCancel={() => {
          setNaming(null);
          setMoving(null);
        }}
      />
    </div>
  );
}

/** Both dialogs, so the panel has one thing to mount. */
export { baseName };
