/**
 * Where an editor should land when it opens: the line a search hit was on.
 *
 * Search opens a file by path; the editor that mounts for it takes the line
 * from here, once, and scrolls to it. Kept out of the address so a reload
 * does not jump again.
 */

const targets = new Map<string, { line: number; column: number; length: number }>();

export function requestLine(path: string, line: number, column = 1, length = 0) {
  targets.set(path, { line, column, length });
}

export function takeLine(path: string): { line: number; column: number; length: number } | null {
  const target = targets.get(path) ?? null;
  targets.delete(path);
  return target;
}
