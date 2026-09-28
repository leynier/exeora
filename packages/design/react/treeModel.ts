/**
 * The shape of a tree and the arithmetic of walking it, kept away from React
 * so the rules can be tested as plain functions.
 */

export type TreeNode<T> = {
  id: string;
  label: string;
  data: T;
  /**
   * Undefined for a branch whose children have not been asked for yet; the
   * view shows the chevron and the owner loads them on the first expand.
   */
  children?: readonly TreeNode<T>[] | undefined;
  /** A leaf never expands. A branch with `children` undefined loads lazily. */
  leaf?: boolean;
};

export type VisibleNode<T> = {
  node: TreeNode<T>;
  depth: number;
  expanded: boolean;
  /** True when the node can expand: a branch, loaded or not. */
  branch: boolean;
  parentId: string | null;
  setSize: number;
  position: number;
};

/** Depth-first, in order, only what is under an expanded ancestor. */
export function flatten<T>(
  roots: readonly TreeNode<T>[],
  expanded: ReadonlySet<string>,
): VisibleNode<T>[] {
  const out: VisibleNode<T>[] = [];
  const walk = (nodes: readonly TreeNode<T>[], depth: number, parentId: string | null) => {
    nodes.forEach((node, index) => {
      const branch = node.leaf !== true;
      const open = branch && expanded.has(node.id);
      out.push({
        node,
        depth,
        expanded: open,
        branch,
        parentId,
        setSize: nodes.length,
        position: index + 1,
      });
      if (open && node.children) walk(node.children, depth + 1, node.id);
    });
  };
  walk(roots, 0, null);
  return out;
}

export type TreeKeyResult =
  | { focus: number }
  | { expand: string }
  | { collapse: string }
  | { activate: string }
  | null;

/**
 * What a key does from row `index`, following the tree view pattern: arrows
 * move, Right opens or steps in, Left closes or steps out, Enter activates,
 * and a printed character jumps to the next label starting with it.
 */
export function treeKey<T>(
  visible: readonly VisibleNode<T>[],
  index: number,
  key: string,
): TreeKeyResult {
  const row = visible[index];
  if (!row) return null;
  switch (key) {
    case "ArrowDown":
      return index + 1 < visible.length ? { focus: index + 1 } : null;
    case "ArrowUp":
      return index > 0 ? { focus: index - 1 } : null;
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: visible.length - 1 };
    case "ArrowRight":
      if (!row.branch) return null;
      if (!row.expanded) return { expand: row.node.id };
      return index + 1 < visible.length && visible[index + 1]?.parentId === row.node.id
        ? { focus: index + 1 }
        : null;
    case "ArrowLeft": {
      if (row.branch && row.expanded) return { collapse: row.node.id };
      if (row.parentId === null) return null;
      const parent = visible.findIndex((item) => item.node.id === row.parentId);
      return parent >= 0 ? { focus: parent } : null;
    }
    case "Enter":
    case " ":
      return { activate: row.node.id };
    default: {
      if (key.length !== 1 || key === " ") return null;
      const wanted = key.toLowerCase();
      for (let step = 1; step <= visible.length; step += 1) {
        const at = (index + step) % visible.length;
        if (visible[at]?.node.label.toLowerCase().startsWith(wanted)) return { focus: at };
      }
      return null;
    }
  }
}

/** The ids of every ancestor of `id`, nearest last, or null when it is not in the tree. */
export function ancestorsOf<T>(roots: readonly TreeNode<T>[], id: string): string[] | null {
  const path: string[] = [];
  const find = (nodes: readonly TreeNode<T>[]): boolean => {
    for (const node of nodes) {
      if (node.id === id) return true;
      if (node.children) {
        path.push(node.id);
        if (find(node.children)) return true;
        path.pop();
      }
    }
    return false;
  };
  return find(roots) ? path : null;
}

/** Whether `candidate` is `id` or lies under it: what a folder cannot be moved into. */
export function isWithin(id: string, candidate: string): boolean {
  return candidate === id || candidate.startsWith(`${id}/`);
}
