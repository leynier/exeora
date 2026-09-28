import { describe, expect, it } from "vitest";
import { splitPatch } from "./patchSplit.js";

describe("splitPatch", () => {
  it("cuts at every file header and names each file", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/docs/b.md b/docs/b.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/docs/b.md",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n");
    const files = splitPatch(patch);
    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "docs/b.md"]);
    expect(files[0]?.patch.split("\n")).toHaveLength(6);
    expect(files[1]?.patch).toContain("+hello");
  });

  it("drops what precedes the first header and handles an empty patch", () => {
    expect(splitPatch("")).toEqual([]);
    expect(
      splitPatch("commit abc\n\n    message\n\ndiff --git a/x b/x\n+1").map((f) => f.path),
    ).toEqual(["x"]);
  });
});
