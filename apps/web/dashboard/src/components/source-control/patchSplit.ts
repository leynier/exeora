/**
 * A patch of many files, cut into one patch per file.
 *
 * The diff renderer takes one file at a time, and git's aggregate output is
 * one stream. Each `diff --git` header starts a file; what precedes the
 * first header (a commit's message in `git show` output) belongs to none.
 */
export type FilePatch = { path: string; patch: string };

export function splitPatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  const lines = patch.split("\n");
  let current: string[] | null = null;
  let path = "";
  const flush = () => {
    if (current && current.length > 0) files.push({ path, patch: current.join("\n") });
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = [line];
      path = pathOf(line);
      continue;
    }
    if (current) current.push(line);
  }
  flush();
  return files;
}

/** The new path of a `diff --git a/x b/y` line; the old one for a deletion is the same. */
function pathOf(header: string): string {
  const rest = header.slice("diff --git ".length);
  const at = rest.indexOf(" b/");
  if (at >= 0) return rest.slice(at + 3);
  return rest.replace(/^a\//, "");
}
