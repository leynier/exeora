import { describe, expect, it } from "vitest";
import {
  batchProblem,
  batchTitle,
  commentProblem,
  type Draft,
  formatBatch,
  LIMITS,
  snippetProblem,
  sourceLabel,
} from "./model.js";

const FILE: Draft = {
  id: "d1",
  source: {
    kind: "file",
    projectId: "p1",
    workspace: "feat@laptop",
    path: "src/a.ts",
    version: "tok3",
    unsaved: false,
    start: { line: 3, column: 5 },
    end: { line: 4, column: 2 },
  },
  snippet: "const x = 1;\nx",
  comment: "Why one?",
  createdAt: 1,
};

const DIFF: Draft = {
  id: "d2",
  source: {
    kind: "diff",
    projectId: "p1",
    workspace: null,
    path: "src/b.ts",
    area: "staged",
    commit: null,
    side: "old",
    oldLines: [11, 12],
    newLines: null,
  },
  snippet: "-old two\n-old ```three",
  comment: "Keep this.",
  createdAt: 2,
};

describe("bounds", () => {
  it("refuses an empty or oversized selection rather than trimming it", () => {
    expect(snippetProblem("  \n ")).toBe("Select some text first.");
    expect(snippetProblem("x".repeat(LIMITS.snippetChars + 1))).toContain("longer than");
    expect(snippetProblem("a\n".repeat(LIMITS.snippetLines + 1))).toContain("more than");
    expect(snippetProblem("ok")).toBeNull();
  });

  it("refuses an empty or oversized comment", () => {
    expect(commentProblem(" ")).toBe("Write a comment first.");
    expect(commentProblem("y".repeat(LIMITS.commentChars + 1))).toContain("at most");
  });

  it("refuses too many comments for one batch", () => {
    const many = Array.from({ length: LIMITS.batchComments + 1 }, (_, i) => ({
      ...FILE,
      id: `d${i}`,
    }));
    expect(batchProblem(many)).toContain("At most");
    expect(batchProblem([])).toBe("There are no comments to add.");
    expect(batchProblem([FILE, DIFF])).toBeNull();
  });
});

describe("formatBatch", () => {
  it("says where each comment points, what was selected, and the comment", () => {
    const text = formatBatch([FILE, DIFF]);
    expect(text).toContain("Project: p1\nWorkspace: feat@laptop\nPath: src/a.ts");
    expect(text).toContain("Selection: file, line 3 column 5 to line 4 column 2");
    expect(text).toContain("Version: tok3");
    expect(text).toContain(
      "Workspace: default root\nPath: src/b.ts\nSelection: staged diff, old side",
    );
    expect(text).toContain("Old lines: 11-12");
    expect(text).toContain("Comment: Why one?");
    // A snippet with a fence of its own cannot close the block around it.
    expect(text).toContain("````diff\n-old two\n-old ```three\n````");
  });

  it("titles and labels a batch for people", () => {
    expect(batchTitle([FILE, DIFF])).toBe("Exeora Workspace: 2 comments on 2 files");
    expect(sourceLabel(FILE.source)).toBe("src/a.ts, lines 3-4");
    expect(sourceLabel(DIFF.source)).toBe("src/b.ts, staged diff, old lines 11-12");
  });
});
