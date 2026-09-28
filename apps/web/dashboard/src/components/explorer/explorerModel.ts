import type { TreeNode } from "@exeora/design/react";
import type { GitFileState } from "../../api.js";
import type { FileTreeEntry } from "../../api-types-workspace.js";

export type ExplorerNode = {
  entry: FileTreeEntry;
  /** The git letter of the file, or of what changed under a folder. */
  status: string | null;
};

/** The listings the Explorer has, by directory path, `"."` for the root. */
export type Listings = ReadonlyMap<string, readonly FileTreeEntry[] | undefined>;

/**
 * The tree the Explorer draws, from the directories it has listed so far.
 *
 * A directory that has not been listed keeps `children` undefined, which the
 * tree view shows as expandable; expanding it is what asks for the listing.
 */
export function buildTree(
  listings: Listings,
  status: ReadonlyMap<string, string>,
): TreeNode<ExplorerNode>[] {
  const build = (dir: string): TreeNode<ExplorerNode>[] | undefined => {
    const entries = listings.get(dir);
    if (!entries) return undefined;
    return entries.map((entry) => {
      const directory = entry.type === "directory";
      const node: TreeNode<ExplorerNode> = {
        id: entry.path,
        label: entry.name,
        data: { entry, status: status.get(entry.path) ?? null },
        leaf: !directory,
      };
      if (directory) {
        const children = build(entry.path);
        if (children) node.children = children;
      }
      return node;
    });
  };
  return build(".") ?? [];
}

const PRIORITY = ["!", "U", "A", "D", "R", "C", "M"];

/**
 * A git letter per changed path, and one per folder above it: the most
 * telling of what is inside, so a folder with a conflict says so.
 */
export function statusLetters(files: readonly GitFileState[]): Map<string, string> {
  const letters = new Map<string, string>();
  const put = (path: string, letter: string) => {
    const current = letters.get(path);
    if (current === undefined || PRIORITY.indexOf(letter) < PRIORITY.indexOf(current)) {
      letters.set(path, letter);
    }
  };
  for (const file of files) {
    const letter =
      file.kind === "conflict"
        ? "!"
        : file.kind === "untracked"
          ? "U"
          : file.index !== "." && file.index !== "?"
            ? file.index
            : file.worktree;
    put(file.path, letter);
    let at = file.path.lastIndexOf("/");
    while (at > 0) {
      put(file.path.slice(0, at), letter);
      at = file.path.lastIndexOf("/", at - 1);
    }
  }
  return letters;
}

export function parentOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "." : path.slice(0, at);
}

export function joinPath(dir: string, name: string): string {
  return dir === "." || dir === "" ? name : `${dir}/${name}`;
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Every directory above `path`, outermost first. */
export function ancestors(path: string): string[] {
  const out: string[] = [];
  let at = path.indexOf("/");
  while (at > 0) {
    out.push(path.slice(0, at));
    at = path.indexOf("/", at + 1);
  }
  return out;
}

/** A name a new file or folder may take: one segment, nothing git or the OS refuses. */
export function validName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "A name is needed.";
  if (trimmed === "." || trimmed === "..") return "That name is taken by the directory itself.";
  if (trimmed.includes("/") || trimmed.includes("\\")) return "A name cannot contain a slash.";
  if (/[\0<>:"|?*]/.test(trimmed)) return 'A name cannot contain < > : " | ? * characters.';
  if (trimmed === ".git") return "That name belongs to git.";
  return null;
}

export type FileKind = "text" | "image" | "markdown" | "pdf" | "binary";

const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif"]);

/** How a file is shown, from its name and what the machine said about it. */
export function fileKind(path: string, mime: string | null, binary: boolean): FileKind {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (mime?.startsWith("image/") || IMAGES.has(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (binary) return "binary";
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown";
  return "text";
}
