import { realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { ExeoraError } from "@exeora/protocol";

/**
 * Keeps every filesystem operation inside the project the caller asked for.
 *
 * This is the only security control in this release: there is no command
 * allowlist and no approval prompt, so a tool call that escapes the project
 * root escapes into the user's whole machine. Treat this file accordingly —
 * the tests in `paths.test.ts` are the specification.
 *
 * Two distinct escapes have to be stopped:
 *
 *   1. **Lexical** — `../../etc/passwd`, or an absolute path. Caught by
 *      resolving against the root and comparing prefixes.
 *   2. **Symbolic** — a symlink inside the project pointing outside it. A
 *      lexical check passes those, so the real path is resolved too.
 *
 * A path that does not exist yet (`write_file` creating a new file) cannot be
 * `realpath`'d, so its nearest existing ancestor is resolved instead. That is
 * what stops `sneaky-link/new.txt`, where `sneaky-link` points at /etc.
 */

/** Separator-aware containment: /project must not match /project-other. */
function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

async function realpathOrNearestAncestor(target: string): Promise<string> {
  let current = target;

  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = resolve(current, "..");
      // Reached the filesystem root without finding anything that exists.
      if (parent === current) return current;
      current = parent;
    }
  }
}

export interface ResolveOptions {
  /** Absolute path of the project root, as registered by `exeora project add`. */
  root: string;
  /** Caller-supplied path, always interpreted relative to the root. */
  relativePath: string;
}

/**
 * Resolves a caller-supplied path to an absolute one inside the project, or
 * throws `PATH_ESCAPE`.
 */
export async function resolveInProject({ root, relativePath }: ResolveOptions): Promise<string> {
  // An absolute path is never accepted. Node's resolve() would silently let it
  // win over the root, which is exactly the escape being prevented.
  if (isAbsolute(relativePath)) {
    throw new ExeoraError("PATH_ESCAPE", "Path must be relative to the project root.");
  }
  // A NUL byte truncates the path inside libc, so a prefix check on the
  // JavaScript string can disagree with what the syscall actually opens.
  if (relativePath.includes("\0")) {
    throw new ExeoraError("PATH_ESCAPE", "Path contains an invalid character.");
  }

  const realRoot = await realpath(root);
  const target = resolve(realRoot, relativePath);

  if (!isInside(target, realRoot)) {
    throw new ExeoraError("PATH_ESCAPE", "Path resolves outside the project root.");
  }

  // Second pass over the real path, so a symlink inside the project cannot
  // point out of it. Non-existent files fall back to their nearest ancestor.
  const realTarget = await realpathOrNearestAncestor(target);
  if (!isInside(realTarget, realRoot)) {
    throw new ExeoraError("PATH_ESCAPE", "Path resolves outside the project root.");
  }

  return target;
}

/** Path relative to the root, for echoing back without leaking host layout. */
export function relativeToRoot(root: string, absolutePath: string): string {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath;
}
