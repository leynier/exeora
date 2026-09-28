import { ContextMenu, type MenuEntry, TreeView } from "@exeora/design/react";
import { Copy, FileDiff, Minus, Plus, Trash, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { GitFileState, WorkspaceAction } from "../../api.js";
import type { DiffArea } from "../../api-types-workspace.js";
import { fileStatusClass, fileStatusCode, type WorkspaceSelection } from "../WorkspaceFileGroup.js";
import { allDirectories, type ChangeNode, changesTree } from "./changesTree.js";

export type ChangeActions = {
  pending: boolean;
  onOpen: (selection: WorkspaceSelection, pin?: boolean) => void;
  onRun: (actions: WorkspaceAction | WorkspaceAction[]) => void;
  onConfirm: (confirm: {
    action: WorkspaceAction;
    title: string;
    body: string;
    label: string;
  }) => void;
};

/**
 * One area's changed files, as a tree with a folder's actions covering
 * everything under it, or as the flat list.
 *
 * Every row carries a menu: open the diff, stage or unstage, discard, copy
 * the path. On a pointer that has one it is the right button; on a touch
 * screen it is a long press.
 */
export function Changes({
  title,
  files,
  area,
  selected,
  tree,
  actions,
}: {
  title: string;
  files: GitFileState[];
  area: DiffArea;
  selected: WorkspaceSelection | null;
  tree: boolean;
  actions: ChangeActions;
}) {
  const all = files.length > 0 ? inChunks(area === "staged" ? "unstage" : "stage", files) : [];
  return (
    <section className="border-border-subtle border-b py-1.5">
      <header className="flex items-center justify-between gap-2 px-3 pb-1">
        <h2 className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
          {title} <span className="tabular-nums">{files.length}</span>
        </h2>
        {files.length > 0 ? (
          <button
            type="button"
            className="text-label-md text-foreground-faint hover:text-foreground rounded px-1.5 py-0.5 disabled:pointer-events-none disabled:opacity-50"
            disabled={actions.pending}
            onClick={() => actions.onRun(all)}
          >
            {area === "staged" ? "Unstage all" : "Stage all"}
          </button>
        ) : null}
      </header>
      {files.length === 0 ? (
        <p className="text-body-md text-foreground-faint px-3 py-1.5">None</p>
      ) : tree ? (
        <ChangesTree files={files} area={area} selected={selected} actions={actions} />
      ) : (
        <ul>
          {files.map((file) => (
            <li key={file.path}>
              <ChangeRow file={file} area={area} selected={selected} actions={actions} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeRow({
  file,
  area,
  selected,
  actions,
}: {
  file: GitFileState;
  area: DiffArea;
  selected: WorkspaceSelection | null;
  actions: ChangeActions;
}) {
  const active = selected?.path === file.path && selected.area === area;
  const code = fileStatusCode(file, area);
  const index = file.path.lastIndexOf("/");
  const dir = index < 0 ? "" : file.path.slice(0, index + 1);
  const name = file.path.slice(index + 1);
  return (
    <ContextMenu label={`Actions for ${file.path}`} entries={fileEntries(file, area, actions)}>
      <div className={`group flex items-center gap-1 px-1.5 ${active ? "bg-accent-subtle" : ""}`}>
        <button
          type="button"
          className="min-w-0 flex-1 rounded px-1.5 py-1.5 text-left"
          title={file.path}
          onClick={() => actions.onOpen({ path: file.path, area })}
          onDoubleClick={() => actions.onOpen({ path: file.path, area }, true)}
        >
          <span className="flex min-w-0 items-baseline gap-2 font-mono text-xs">
            <span
              className={`w-3 shrink-0 text-center font-medium ${fileStatusClass(code, file.kind)}`}
            >
              {code}
            </span>
            <span className="min-w-0 truncate">
              {dir ? <span className="text-foreground-faint">{dir}</span> : null}
              <span className="text-foreground">{name}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          className="text-label-md text-foreground-faint hover:bg-surface-variant invisible shrink-0 rounded px-1.5 py-1 group-hover:visible group-focus-within:visible disabled:pointer-events-none"
          disabled={actions.pending}
          onClick={() =>
            actions.onRun({ action: area === "staged" ? "unstage" : "stage", paths: [file.path] })
          }
        >
          {area === "staged" ? "Unstage" : "Stage"}
        </button>
      </div>
    </ContextMenu>
  );
}

function ChangesTree({
  files,
  area,
  selected,
  actions,
}: {
  files: GitFileState[];
  area: DiffArea;
  selected: WorkspaceSelection | null;
  actions: ChangeActions;
}) {
  const roots = useMemo(() => changesTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Folders start open; the set remembers what was closed, so a folder that
  // appears with the next status is open too.
  const expanded = useMemo(
    () => new Set(allDirectories(roots).filter((id) => !collapsed.has(id))),
    [roots, collapsed],
  );
  return (
    <TreeView
      label={`${area === "staged" ? "Staged" : "Changed"} files`}
      roots={roots}
      expanded={expanded}
      selectedId={selected?.area === area && selected ? `file:${selected.path}` : null}
      onToggle={(id, open) =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (open) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      onActivate={(node) => {
        if (node.data.kind === "file") actions.onOpen({ path: node.data.path, area }, true);
      }}
      onSelect={(node) => {
        if (node.data.kind === "file") actions.onOpen({ path: node.data.path, area });
      }}
      menu={{
        label: (node) => `Actions for ${node.data.path}`,
        entries: (node) =>
          node.data.kind === "file"
            ? fileEntries(node.data.file, area, actions)
            : folderEntries(node.data, area, actions),
      }}
      renderRow={(row) => {
        const data = row.node.data;
        return (
          <span className="flex min-w-0 flex-1 items-center gap-2 py-1 font-mono text-xs">
            {data.kind === "file" ? (
              <span
                className={`w-3 shrink-0 text-center font-medium ${fileStatusClass(
                  fileStatusCode(data.file, area),
                  data.file.kind,
                )}`}
              >
                {fileStatusCode(data.file, area)}
              </span>
            ) : null}
            <span
              className={`min-w-0 truncate ${data.kind === "dir" ? "text-foreground-muted" : "text-foreground"}`}
            >
              {row.node.label}
            </span>
            {data.kind === "dir" ? (
              <span className="text-foreground-faint ml-auto shrink-0 tabular-nums">
                {data.count}
              </span>
            ) : null}
          </span>
        );
      }}
    />
  );
}

function fileEntries(file: GitFileState, area: DiffArea, actions: ChangeActions): MenuEntry[] {
  const path = file.path;
  const entries: MenuEntry[] = [
    { label: "Open diff", icon: FileDiff, onSelect: () => actions.onOpen({ path, area }, true) },
    area === "staged"
      ? {
          label: "Unstage",
          icon: Minus,
          onSelect: () => actions.onRun({ action: "unstage", paths: [path] }),
        }
      : {
          label: "Stage",
          icon: Plus,
          onSelect: () => actions.onRun({ action: "stage", paths: [path] }),
        },
    { label: "Copy path", icon: Copy, onSelect: () => void copyPath(path) },
  ];
  if (area === "working") {
    entries.push({ separator: true });
    entries.push(
      file.kind === "untracked"
        ? {
            label: "Delete file",
            icon: Trash,
            danger: true,
            onSelect: () =>
              actions.onConfirm({
                action: { action: "delete_untracked", paths: [path] },
                title: "Delete untracked file?",
                body: `${path} will be permanently deleted from the machine that holds this workspace.`,
                label: "Delete file",
              }),
          }
        : {
            label: "Discard changes",
            icon: Undo2,
            danger: true,
            onSelect: () =>
              actions.onConfirm({
                action: { action: "discard", paths: [path] },
                title: "Discard local changes?",
                body: `Uncommitted changes in ${path} cannot be recovered by Exeora.`,
                label: "Discard changes",
              }),
          },
    );
  }
  return entries.map((entry) =>
    entry.separator ? entry : { ...entry, disabled: actions.pending },
  );
}

function folderEntries(
  folder: Extract<ChangeNode, { kind: "dir" }>,
  area: DiffArea,
  actions: ChangeActions,
): MenuEntry[] {
  const count = `${folder.count} ${folder.count === 1 ? "file" : "files"}`;
  const entries: MenuEntry[] = [
    area === "staged"
      ? {
          label: `Unstage ${count}`,
          icon: Minus,
          onSelect: () => actions.onRun(inChunks("unstage", folder.files)),
        }
      : {
          label: `Stage ${count}`,
          icon: Plus,
          onSelect: () => actions.onRun(inChunks("stage", folder.files)),
        },
    { label: "Copy path", icon: Copy, onSelect: () => void copyPath(folder.path) },
  ];
  const tracked = folder.files.filter((file) => file.kind !== "untracked");
  if (area === "working" && tracked.length > 0) {
    entries.push({ separator: true });
    entries.push({
      label: `Discard changes in ${folder.path}`,
      icon: Undo2,
      danger: true,
      onSelect: () =>
        actions.onConfirm({
          action: {
            action: "discard",
            paths: tracked.slice(0, MAX_PATHS_PER_ACTION).map((f) => f.path),
          },
          title: "Discard local changes?",
          body: `Uncommitted changes in ${tracked.length} tracked ${tracked.length === 1 ? "file" : "files"} under ${folder.path} cannot be recovered by Exeora. Untracked files stay.`,
          label: "Discard changes",
        }),
    });
  }
  return entries.map((entry) =>
    entry.separator ? entry : { ...entry, disabled: actions.pending },
  );
}

async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    // Without clipboard access the menu simply closes; nothing else to say.
  }
}

/** The protocol caps one request at 1,000 paths; "Stage all" is not capped. */
export const MAX_PATHS_PER_ACTION = 1_000;

export function inChunks(
  action: "stage" | "unstage",
  files: readonly { path: string }[],
): WorkspaceAction[] {
  const actions: WorkspaceAction[] = [];
  for (let start = 0; start < files.length; start += MAX_PATHS_PER_ACTION) {
    const paths = files.slice(start, start + MAX_PATHS_PER_ACTION).map((file) => file.path);
    actions.push({ action, paths });
  }
  return actions;
}
