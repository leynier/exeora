import { describe, expect, it } from "vitest";
import { diffSelection, patchNames, patchRows, selectedRows } from "./diffSelection.js";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1..2 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,4 +10,4 @@",
  " keep one",
  "-old two",
  "-old three",
  "+new two",
  " keep four",
].join("\n");

/** Context, an old line, opposite additions, an old line, context. */
const INTERLEAVED = [
  "diff --git a/b.ts b/b.ts",
  "--- a/b.ts",
  "+++ b/b.ts",
  "@@ -1,5 +1,5 @@",
  " ctx one",
  "-old A",
  "+new A",
  "+new B",
  "-old B",
  " ctx two",
].join("\n");

const PLACE = { path: "src/a.ts", oldPath: null, area: "staged" as const, commit: null };

describe("patchRows", () => {
  it("numbers each row on the side it belongs to", () => {
    expect(patchRows(PATCH)).toEqual([
      { type: "context", old: 10, new: 10, text: "keep one" },
      { type: "deletion", old: 11, new: null, text: "old two" },
      { type: "deletion", old: 12, new: null, text: "old three" },
      { type: "addition", old: null, new: 11, text: "new two" },
      { type: "context", old: 13, new: 12, text: "keep four" },
    ]);
  });
});

describe("diffSelection", () => {
  it("takes deleted lines of the old side", () => {
    const selected = diffSelection(PATCH, { start: 11, side: "deletions", end: 12 }, PLACE);
    expect(selected).toEqual({
      snippet: "-old two\n-old three",
      source: {
        kind: "diff",
        path: "src/a.ts",
        oldPath: null,
        area: "staged",
        commit: null,
        side: "old",
        oldLines: [11, 12],
        newLines: null,
      },
    });
  });

  it("takes added lines of the new side", () => {
    const selected = diffSelection(PATCH, { start: 11, side: "additions", end: 11 }, PLACE);
    expect(selected?.snippet).toBe("+new two");
    expect(selected?.source).toMatchObject({ side: "new", oldLines: null, newLines: [11, 11] });
  });

  it("spans every row in between in one column, as a unified view shows them", () => {
    const selected = diffSelection(
      PATCH,
      { start: 10, side: "additions", end: 12, endSide: "additions" },
      PLACE,
    );
    expect(selected?.snippet).toBe(" keep one\n-old two\n-old three\n+new two\n keep four");
    expect(selected?.source).toMatchObject({
      side: "both",
      oldLines: [10, 13],
      newLines: [10, 12],
    });
  });

  it("keeps a side-by-side old-column range to the old column, past opposite additions", () => {
    const selected = diffSelection(
      INTERLEAVED,
      { start: 1, side: "deletions", end: 4, endSide: "deletions" },
      { ...PLACE, path: "b.ts" },
      "split",
    );
    expect(selected?.snippet).toBe(" ctx one\n-old A\n-old B\n ctx two");
    expect(selected?.source).toMatchObject({ side: "old", oldLines: [1, 4], newLines: null });
  });

  it("keeps a side-by-side new-column range to the new column, past opposite deletions", () => {
    const selected = diffSelection(
      INTERLEAVED,
      { start: 1, side: "additions", end: 4, endSide: "additions" },
      { ...PLACE, path: "b.ts" },
      "split",
    );
    expect(selected?.snippet).toBe(" ctx one\n+new A\n+new B\n ctx two");
    expect(selected?.source).toMatchObject({ side: "new", oldLines: null, newLines: [1, 4] });
  });

  it("keeps the selected side of context-only lines", () => {
    expect(
      diffSelection(INTERLEAVED, { start: 1, side: "deletions", end: 1 }, PLACE, "split")?.source,
    ).toMatchObject({ side: "old", oldLines: [1, 1], newLines: null });
    expect(
      diffSelection(INTERLEAVED, { start: 4, side: "additions", end: 4 }, PLACE, "split")?.source,
    ).toMatchObject({ side: "new", oldLines: null, newLines: [4, 4] });
  });

  it("includes both columns when a selection crosses them", () => {
    const selected = diffSelection(
      INTERLEAVED,
      { start: 2, side: "deletions", end: 3, endSide: "additions" },
      PLACE,
      "split",
    );
    expect(selected?.snippet).toBe("-old A\n+new A\n+new B");
    expect(selected?.source.side).toBe("both");
  });

  it("covers a whole deleted file", () => {
    const deleted = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-first",
      "-second",
    ].join("\n");
    const selected = diffSelection(
      deleted,
      { start: 1, side: "deletions", end: 2 },
      {
        ...PLACE,
        path: "gone.ts",
      },
    );
    expect(selected).toMatchObject({
      snippet: "-first\n-second",
      source: { path: "gone.ts", side: "old", oldLines: [1, 2], newLines: null },
    });
  });

  it("names nothing for a range outside the patch", () => {
    expect(selectedRows(patchRows(PATCH), { start: 99, side: "additions", end: 99 })).toBeNull();
    expect(diffSelection(PATCH, { start: 99, end: 99 }, PLACE)).toBeNull();
  });
});

describe("patchNames", () => {
  it("keeps a rename's old path", () => {
    const renamed = [
      "diff --git a/old name.ts b/new name.ts",
      "similarity index 90%",
      "rename from old name.ts",
      "rename to new name.ts",
      "--- a/old name.ts",
      "+++ b/new name.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    expect(patchNames(renamed, "x")).toEqual({ path: "new name.ts", oldPath: "old name.ts" });
  });

  it("decodes a quoted path git wrote for a non-ASCII name", () => {
    const quoted = [
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
      "index 1..2 100644",
      '--- "a/caf\\303\\251.txt"',
      '+++ "b/caf\\303\\251.txt"',
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    expect(patchNames(quoted, "fallback").path).toBe("café.txt");
  });

  it("falls back to the listed path when the header says nothing", () => {
    expect(patchNames("not a patch", "listed.ts")).toEqual({ path: "listed.ts", oldPath: null });
  });
});
