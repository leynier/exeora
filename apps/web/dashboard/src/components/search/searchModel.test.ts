import { describe, expect, it } from "vitest";
import type { SearchFile } from "../../api-types-workspace.js";
import {
  allBranches,
  blockedByEdits,
  searchList,
  searchTree,
  splitPreview,
  summary,
} from "./searchModel.js";

const file = (path: string, matches = 1): SearchFile => ({
  path,
  token: "t",
  matches: Array.from({ length: matches }, (_, i) => ({
    line: i + 1,
    column: 1,
    length: 3,
    preview: `x foo y`,
    previewOffset: 2,
  })),
  truncated: false,
});

describe("searchTree", () => {
  it("nests files under folders with match counts", () => {
    const tree = searchTree([file("src/a.ts", 2), file("b.ts")]);
    expect(tree.map((n) => n.id)).toEqual(["dir:src", "file:b.ts"]);
    expect(tree[0]?.data).toMatchObject({ kind: "dir", count: 2 });
    expect(tree[0]?.children?.[0]?.children).toHaveLength(2);
    expect(allBranches(tree)).toEqual(["dir:src", "file:src/a.ts", "file:b.ts"]);
    expect(searchList([file("src/a.ts")]).map((n) => n.id)).toEqual(["file:src/a.ts"]);
  });
});

describe("summary", () => {
  it("counts and says when it stopped", () => {
    expect(summary(undefined, true)).toBe("Searching…");
    expect(
      summary(
        {
          kind: "search",
          files: [file("a"), file("b", 2)],
          totalMatches: 3,
          truncated: false,
          filesSearched: 9,
          filesSkipped: 1,
        },
        false,
      ),
    ).toBe("3 matches in 2 files, 1 skipped");
    expect(
      summary(
        {
          kind: "search",
          files: [file("a")],
          totalMatches: 1,
          truncated: true,
          filesSearched: 1,
          filesSkipped: 0,
        },
        false,
      ),
    ).toBe("1+ match in 1 file shown");
    expect(
      summary(
        {
          kind: "search",
          files: [],
          totalMatches: 0,
          truncated: false,
          filesSearched: 1,
          filesSkipped: 0,
        },
        false,
      ),
    ).toBe("No results");
  });
});

describe("splitPreview", () => {
  it("cuts the match out by characters, not bytes", () => {
    expect(
      splitPreview(
        { line: 1, column: 3, length: 2, preview: "héllo wörld", previewOffset: 6 },
        "X",
      ),
    ).toEqual({
      before: "héllo ",
      hit: "wö",
      after: "rld",
      replaced: "X",
    });
  });
});

describe("blockedByEdits", () => {
  it("names the files an editor holds", () => {
    expect(blockedByEdits(["a", "b"], new Set(["b"]))).toEqual(["b"]);
  });
});
