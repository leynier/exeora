import { describe, expect, it } from "vitest";
import type { GitFileState } from "../../api.js";
import { allDirectories, changesTree } from "./changesTree.js";

const file = (path: string): GitFileState => ({
  path,
  index: ".",
  worktree: "M",
  kind: "tracked",
  submodule: false,
});

describe("changesTree", () => {
  it("groups by directory, folders first, without regard to case", () => {
    const tree = changesTree([
      file("src/b.ts"),
      file("readme.md"),
      file("src/A.ts"),
      file("Docs/x.md"),
    ]);
    expect(tree.map((node) => node.label)).toEqual(["Docs", "src", "readme.md"]);
    const src = tree[1];
    expect(src?.data).toMatchObject({ kind: "dir", path: "src", count: 2 });
    expect(src?.children?.map((node) => node.label)).toEqual(["A.ts", "b.ts"]);
  });

  it("carries every file under a folder, at every depth", () => {
    const tree = changesTree([file("a/b/c.ts"), file("a/d.ts")]);
    const a = tree[0];
    expect(a?.data.kind === "dir" && a.data.files.map((item) => item.path)).toEqual([
      "a/b/c.ts",
      "a/d.ts",
    ]);
    expect(allDirectories(tree)).toEqual(["dir:a", "dir:a/b"]);
  });
});
