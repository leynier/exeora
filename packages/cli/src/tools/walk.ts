import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";

/**
 * Directory traversal that honours .gitignore.
 *
 * pi's `find` respects .gitignore but its `grep` does not, it will happily
 * walk into node_modules. Since both tools advertise that they skip ignored
 * files, the filter is applied here rather than trusted to the library.
 */

/** Skipped regardless of .gitignore: no repository wants these searched. */
const ALWAYS_SKIP = new Set([".git", "node_modules", ".wrangler", "dist", ".astro"]);

export async function loadIgnore(root: string): Promise<Ignore> {
  const matcher = ignore();
  try {
    matcher.add(await readFile(join(root, ".gitignore"), "utf8"));
  } catch {
    // No .gitignore is normal; ALWAYS_SKIP still applies.
  }
  return matcher;
}

export interface WalkEntry {
  /** Path relative to the root, always with forward slashes. */
  path: string;
  absolutePath: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size?: number;
}

export interface WalkOptions {
  root: string;
  /** Directory to start from. Defaults to the root. */
  start?: string;
  recursive: boolean;
  /** Stop after this many entries; the caller reports truncation. */
  limit: number;
}

/**
 * Yields entries under `start`, skipping ignored paths.
 *
 * Symlinked directories are reported but never followed: following them can
 * leave the project (which `resolveInProject` would reject anyway) and can
 * loop forever on a cycle.
 */
export async function* walk(options: WalkOptions): AsyncGenerator<WalkEntry> {
  const matcher = await loadIgnore(options.root);
  const start = options.start ?? options.root;
  let yielded = 0;

  const queue: string[] = [start];

  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by queue.length
    const directory = queue.shift()!;

    let dirents: Dirent[];
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: skip rather than abort the whole walk
    }

    for (const dirent of dirents) {
      if (yielded >= options.limit) return;

      const absolutePath = join(directory, dirent.name);
      const relativePath = relative(options.root, absolutePath).split(sep).join("/");
      const isDirectory = dirent.isDirectory();

      if (ALWAYS_SKIP.has(dirent.name)) continue;
      // `ignore` needs a trailing slash to match directory-only rules.
      if (matcher.ignores(isDirectory ? `${relativePath}/` : relativePath)) continue;

      yielded++;
      yield {
        path: relativePath,
        absolutePath,
        isDirectory,
        isSymbolicLink: dirent.isSymbolicLink(),
      };

      if (isDirectory && options.recursive && !dirent.isSymbolicLink()) {
        queue.push(absolutePath);
      }
    }
  }
}
