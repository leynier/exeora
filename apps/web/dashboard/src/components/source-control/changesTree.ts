import type { TreeNode } from "@exeora/design/react";
import type { GitFileState } from "../../api.js";

export type ChangeNode =
  | { kind: "dir"; path: string; count: number; files: GitFileState[] }
  | { kind: "file"; path: string; file: GitFileState };

/**
 * Changed files grouped by directory, for the tree view of the changes.
 *
 * Every directory carries the files under it, so staging or discarding a
 * folder is one action over that list rather than a walk of the tree.
 */
export function changesTree(files: readonly GitFileState[]): TreeNode<ChangeNode>[] {
  type Dir = { dirs: Map<string, Dir>; files: GitFileState[]; all: GitFileState[] };
  const root: Dir = { dirs: new Map(), files: [], all: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let dir = root;
    dir.all.push(file);
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [], all: [] };
        dir.dirs.set(part, next);
      }
      next.all.push(file);
      dir = next;
    }
    dir.files.push(file);
  }
  const build = (dir: Dir, prefix: string): TreeNode<ChangeNode>[] => {
    const dirs = [...dir.dirs.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([name, child]): TreeNode<ChangeNode> => {
        const path = prefix ? `${prefix}/${name}` : name;
        return {
          id: `dir:${path}`,
          label: name,
          data: { kind: "dir", path, count: child.all.length, files: child.all },
          children: build(child, path),
        };
      });
    const leaves = dir.files
      .slice()
      .sort((a, b) => compare(a.path, b.path))
      .map(
        (file): TreeNode<ChangeNode> => ({
          id: `file:${file.path}`,
          label: file.path.slice(file.path.lastIndexOf("/") + 1),
          data: { kind: "file", path: file.path, file },
          leaf: true,
        }),
      );
    return [...dirs, ...leaves];
  };
  return build(root, "");
}

/** Every directory id in the tree, to start with all of them open. */
export function allDirectories(nodes: readonly TreeNode<ChangeNode>[]): string[] {
  const out: string[] = [];
  const walk = (items: readonly TreeNode<ChangeNode>[]) => {
    for (const node of items) {
      if (node.data.kind === "dir") {
        out.push(node.id);
        if (node.children) walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

function compare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}
