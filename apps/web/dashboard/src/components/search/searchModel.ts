import type { TreeNode } from "@exeora/design/react";
import type { SearchFile, SearchMatch, SearchResult } from "../../api-types-workspace.js";

export type SearchNode =
  | { kind: "dir"; path: string; count: number }
  | { kind: "file"; path: string; file: SearchFile }
  | { kind: "match"; path: string; file: SearchFile; match: SearchMatch };

/** Files under their folders, matches under their files, for the tree view. */
export function searchTree(files: readonly SearchFile[]): TreeNode<SearchNode>[] {
  type Dir = { dirs: Map<string, Dir>; files: SearchFile[]; count: number };
  const root: Dir = { dirs: new Map(), files: [], count: 0 };
  for (const file of files) {
    let dir = root;
    dir.count += file.matches.length;
    for (const part of file.path.split("/").slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [], count: 0 };
        dir.dirs.set(part, next);
      }
      next.count += file.matches.length;
      dir = next;
    }
    dir.files.push(file);
  }
  const build = (dir: Dir, prefix: string): TreeNode<SearchNode>[] => [
    ...[...dir.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map(([name, child]): TreeNode<SearchNode> => {
        const path = prefix ? `${prefix}/${name}` : name;
        return {
          id: `dir:${path}`,
          label: name,
          data: { kind: "dir", path, count: child.count },
          children: build(child, path),
        };
      }),
    ...dir.files.map((file) => fileNode(file)),
  ];
  return build(root, "");
}

/** Every file at the top, matches under it: the flat view. */
export function searchList(files: readonly SearchFile[]): TreeNode<SearchNode>[] {
  return files.map((file) => fileNode(file));
}

function fileNode(file: SearchFile): TreeNode<SearchNode> {
  return {
    id: `file:${file.path}`,
    label: file.path,
    data: { kind: "file", path: file.path, file },
    children: file.matches.map((match) => ({
      id: `match:${file.path}:${match.line}:${match.column}`,
      label: match.preview,
      data: { kind: "match", path: file.path, file, match },
      leaf: true,
    })),
  };
}

/** Every branch of the results, to start with all of them open. */
export function allBranches(nodes: readonly TreeNode<SearchNode>[]): string[] {
  const out: string[] = [];
  const walk = (items: readonly TreeNode<SearchNode>[]) => {
    for (const node of items) {
      if (node.data.kind !== "match") {
        out.push(node.id);
        if (node.children) walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export function summary(result: SearchResult | undefined, searching: boolean): string {
  if (searching && !result) return "Searching…";
  if (!result) return "";
  if (result.totalMatches === 0) return "No results";
  const files = `${result.files.length} ${result.files.length === 1 ? "file" : "files"}`;
  const matches = `${result.totalMatches}${result.truncated ? "+" : ""} ${result.totalMatches === 1 ? "match" : "matches"}`;
  const skipped = result.filesSkipped > 0 ? `, ${result.filesSkipped} skipped` : "";
  return `${matches} in ${files}${result.truncated ? " shown" : ""}${skipped}`;
}

/**
 * The preview with the match cut out of it, so it can be drawn highlighted,
 * and with the replacement where it would go.
 */
export function splitPreview(
  match: SearchMatch,
  replacement: string | null,
): { before: string; hit: string; after: string; replaced: string | null } {
  const chars = [...match.preview];
  const before = chars.slice(0, match.previewOffset).join("");
  const hit = chars.slice(match.previewOffset, match.previewOffset + match.length).join("");
  const after = chars.slice(match.previewOffset + match.length).join("");
  return { before, hit, after, replaced: replacement };
}

/** Files a replace would write that an editor still holds unsaved. */
export function blockedByEdits(paths: readonly string[], dirty: ReadonlySet<string>): string[] {
  return paths.filter((path) => dirty.has(path));
}
