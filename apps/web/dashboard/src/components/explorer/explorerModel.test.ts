import { describe, expect, it } from "vitest";
import type { GitFileState } from "../../api.js";
import type { FileTreeEntry } from "../../api-types-workspace.js";
import {
  ancestors,
  buildTree,
  fileKind,
  joinPath,
  parentOf,
  statusLetters,
  validName,
} from "./explorerModel.js";

const entry = (path: string, type: FileTreeEntry["type"] = "file"): FileTreeEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  type,
  ignored: false,
});

const file = (path: string, index = ".", worktree = "M", kind: GitFileState["kind"] = "tracked") =>
  ({ path, index, worktree, kind, submodule: false }) as GitFileState;

describe("buildTree", () => {
  it("nests listed directories and leaves the others to load", () => {
    const listings = new Map<string, FileTreeEntry[] | undefined>([
      [".", [entry("src", "directory"), entry("docs", "directory"), entry("a.txt")]],
      ["src", [entry("src/main.ts")]],
    ]);
    const tree = buildTree(
      listings,
      new Map([
        ["src", "M"],
        ["src/main.ts", "M"],
      ]),
    );
    expect(tree.map((node) => node.id)).toEqual(["src", "docs", "a.txt"]);
    expect(tree[0]?.children?.map((node) => node.id)).toEqual(["src/main.ts"]);
    expect(tree[0]?.data.status).toBe("M");
    expect(tree[1]?.children).toBeUndefined();
    expect(tree[1]?.leaf).toBe(false);
    expect(tree[2]?.leaf).toBe(true);
  });
});

describe("statusLetters", () => {
  it("marks files and the folders above them, the most telling letter winning", () => {
    const letters = statusLetters([
      file("src/a.ts"),
      file("src/lib/new.ts", ".", ".", "untracked"),
      file("src/lib/x.ts", "U", "U", "conflict"),
      file("docs/d.md", "A", "."),
    ]);
    expect(letters.get("src/a.ts")).toBe("M");
    expect(letters.get("src")).toBe("!");
    expect(letters.get("src/lib")).toBe("!");
    expect(letters.get("docs")).toBe("A");
    expect(letters.get("docs/d.md")).toBe("A");
    expect(letters.has("other")).toBe(false);
  });
});

describe("paths", () => {
  it("walks up and joins", () => {
    expect(parentOf("a/b/c")).toBe("a/b");
    expect(parentOf("a")).toBe(".");
    expect(joinPath(".", "x")).toBe("x");
    expect(joinPath("a/b", "x")).toBe("a/b/x");
    expect(ancestors("a/b/c.txt")).toEqual(["a", "a/b"]);
    expect(ancestors("c.txt")).toEqual([]);
  });
});

describe("validName", () => {
  it("refuses what a path cannot take", () => {
    expect(validName("ok.txt")).toBeNull();
    expect(validName("")).toMatch(/needed/);
    expect(validName("a/b")).toMatch(/slash/);
    expect(validName("..")).toMatch(/taken/);
    expect(validName(".git")).toMatch(/git/);
  });
});

describe("fileKind", () => {
  it("reads the extension and what the machine said", () => {
    expect(fileKind("a.png", "image/png", true)).toBe("image");
    expect(fileKind("a.svg", null, false)).toBe("image");
    expect(fileKind("readme.md", null, false)).toBe("markdown");
    expect(fileKind("a.bin", null, true)).toBe("binary");
    expect(fileKind("a.ts", null, false)).toBe("text");
  });
});
