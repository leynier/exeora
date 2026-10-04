/** Resolve only canonical paths; reject traversal instead of normalizing it away. */
export function relativeWorkspacePath(root: string, absolute: string): string | null {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const base = normalize(root);
  const full = normalize(absolute);
  const absolutePath = (value: string) => value.startsWith("/") || /^[A-Za-z]:\//.test(value);
  if (!absolutePath(base) || !absolutePath(full)) return null;
  if (
    [base, full].some(
      (value) =>
        value.includes("\0") || value.split("/").some((part) => part === "." || part === ".."),
    )
  )
    return null;
  const windows = /^[A-Za-z]:\//.test(base);
  const prefix = `${base}/`;
  if (!(windows ? full.toLowerCase().startsWith(prefix.toLowerCase()) : full.startsWith(prefix)))
    return null;
  const relative = full.slice(prefix.length);
  return relative && !relative.startsWith("/") ? relative : null;
}

export function safeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 4096 &&
    !value.includes("\0") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split("/").some((part) => part === ".." || part === "." || part === "")
  );
}
