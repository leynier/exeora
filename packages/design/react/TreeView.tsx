import { ChevronRight } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useContextMenu } from "./ContextMenu.js";
import type { MenuEntry } from "./menu.js";
import { flatten, type TreeNode, treeKey, type VisibleNode } from "./treeModel.js";

/**
 * A tree of rows: files and folders, changed paths grouped by directory,
 * search hits under their file.
 *
 * The rows are the flattened visible nodes, so the DOM is a list and only what
 * is on screen under an open branch exists. One row is in the tab order; the
 * arrow keys, Home, End and typing a letter move between them. The owner keeps
 * the set of expanded ids and the selection, and draws each row's contents.
 */
export function TreeView<T>({
  roots,
  expanded,
  onToggle,
  onActivate,
  selectedId = null,
  onSelect,
  renderRow,
  label,
  indent = 12,
  drag,
  menu,
  className = "",
}: {
  roots: readonly TreeNode<T>[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string, open: boolean) => void;
  /** Enter, or a click on a leaf: open the file, show the diff. */
  onActivate: (node: TreeNode<T>) => void;
  selectedId?: string | null;
  onSelect?: (node: TreeNode<T>) => void;
  /** What a row shows after its chevron. */
  renderRow: (row: VisibleNode<T>) => ReactNode;
  label: string;
  indent?: number;
  /** Drag and drop between rows, on a pointer that has it. */
  drag?: {
    canDrag: (node: TreeNode<T>) => boolean;
    canDrop: (source: TreeNode<T>, target: TreeNode<T>) => boolean;
    onDrop: (source: TreeNode<T>, target: TreeNode<T>) => void;
  };
  /** A row's menu, on a right click or a long press. */
  menu?: { label: (node: TreeNode<T>) => string; entries: (node: TreeNode<T>) => MenuEntry[] };
  className?: string;
}) {
  const visible = useMemo(() => flatten(roots, expanded), [roots, expanded]);
  const rowMenu = useContextMenu();
  const list = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const focusedIndex = visible.findIndex((row) => row.node.id === focusedId);
  const tabStop =
    focusedIndex >= 0
      ? focusedIndex
      : Math.max(
          0,
          visible.findIndex((row) => row.node.id === selectedId),
        );

  useEffect(() => {
    if (focusedId !== null && focusedIndex < 0) setFocusedId(null);
  }, [focusedId, focusedIndex]);

  const focusRow = (index: number) => {
    const row = visible[index];
    if (!row) return;
    setFocusedId(row.node.id);
    list.current
      ?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(row.node.id)}"]`)
      ?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-tree-id]");
    const index = visible.findIndex((row) => row.node.id === current?.dataset.treeId);
    if (index < 0) return;
    const result = treeKey(visible, index, event.key);
    if (!result) return;
    event.preventDefault();
    if ("focus" in result) focusRow(result.focus);
    else if ("expand" in result) onToggle(result.expand, true);
    else if ("collapse" in result) onToggle(result.collapse, false);
    else {
      const row = visible[index];
      if (row) onActivate(row.node);
    }
  };

  return (
    <div
      ref={list}
      role="tree"
      aria-label={label}
      className={`outline-none ${className}`}
      onKeyDown={onKeyDown}
    >
      {visible.map((row, index) => {
        const { node } = row;
        const selected = node.id === selectedId;
        const droppable = drag !== undefined && dragging !== null && dragging !== node.id;
        const draggable = drag?.canDrag(node) === true;
        const triggers = menu ? rowMenu.triggers(menu.label(node), () => menu.entries(node)) : null;
        return (
          // The keyboard reaches a row through the tree's own handler above,
          // which is where a tree's keys are defined, not row by row.
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the tree
          <div
            key={node.id}
            role="treeitem"
            data-tree-id={node.id}
            aria-level={row.depth + 1}
            aria-setsize={row.setSize}
            aria-posinset={row.position}
            aria-expanded={row.branch ? row.expanded : undefined}
            aria-selected={selected}
            tabIndex={index === tabStop ? 0 : -1}
            draggable={draggable}
            style={{ paddingLeft: row.depth * indent + 4 }}
            className={`group flex min-w-0 cursor-default items-center gap-0.5 rounded-md pr-1 outline-none select-none focus-visible:-outline-offset-2 ${
              selected ? "bg-accent-subtle text-foreground" : "hover:bg-surface-variant"
            } ${over === node.id ? "ring-brand ring-1 ring-inset" : ""} ${
              dragging === node.id ? "opacity-50" : ""
            }`}
            onFocus={() => setFocusedId(node.id)}
            {...triggers}
            onClick={() => {
              onSelect?.(node);
              if (row.branch) onToggle(node.id, !row.expanded);
              else onActivate(node);
            }}
            onDoubleClick={() => {
              if (row.branch) onActivate(node);
            }}
            onDragStart={(event: DragEvent) => {
              if (!draggable) return;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", node.id);
              setDragging(node.id);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(event: DragEvent) => {
              if (!droppable || !drag) return;
              const source = visible.find((item) => item.node.id === dragging)?.node;
              if (!source || !drag.canDrop(source, node)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== node.id) setOver(node.id);
            }}
            onDragLeave={() => {
              if (over === node.id) setOver(null);
            }}
            onDrop={(event: DragEvent) => {
              if (!droppable || !drag) return;
              event.preventDefault();
              const source = visible.find((item) => item.node.id === dragging)?.node;
              setDragging(null);
              setOver(null);
              if (source && drag.canDrop(source, node)) drag.onDrop(source, node);
            }}
          >
            {row.branch ? (
              <ChevronRight
                aria-hidden="true"
                className={`text-foreground-faint size-3.5 shrink-0 transition-transform duration-fast ${
                  row.expanded ? "rotate-90" : ""
                }`}
              />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            {renderRow(row)}
          </div>
        );
      })}
      {menu ? rowMenu.panel : null}
    </div>
  );
}
