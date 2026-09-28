import { describe, expect, it } from "vitest";
import { ancestorsOf, flatten, isWithin, type TreeNode, treeKey } from "./treeModel.js";

const roots: TreeNode<null>[] = [
  {
    id: "src",
    label: "src",
    data: null,
    children: [
      { id: "src/a.ts", label: "a.ts", data: null, leaf: true },
      { id: "src/lib", label: "lib", data: null },
    ],
  },
  { id: "readme.md", label: "readme.md", data: null, leaf: true },
];

describe("flatten", () => {
  it("lists only what is under an expanded branch", () => {
    expect(flatten(roots, new Set()).map((row) => row.node.id)).toEqual(["src", "readme.md"]);
    const open = flatten(roots, new Set(["src"]));
    expect(open.map((row) => row.node.id)).toEqual(["src", "src/a.ts", "src/lib", "readme.md"]);
    expect(open[1]).toMatchObject({ depth: 1, parentId: "src", setSize: 2, position: 1 });
    expect(open[2]).toMatchObject({ branch: true, expanded: false });
  });

  it("treats an unloaded branch as expandable", () => {
    const rows = flatten(roots, new Set(["src", "src/lib"]));
    expect(rows.find((row) => row.node.id === "src/lib")).toMatchObject({
      branch: true,
      expanded: true,
    });
    expect(rows).toHaveLength(4);
  });
});

describe("treeKey", () => {
  const open = flatten(roots, new Set(["src"]));

  it("moves up and down within bounds", () => {
    expect(treeKey(open, 0, "ArrowDown")).toEqual({ focus: 1 });
    expect(treeKey(open, 3, "ArrowDown")).toBeNull();
    expect(treeKey(open, 0, "ArrowUp")).toBeNull();
    expect(treeKey(open, 2, "Home")).toEqual({ focus: 0 });
    expect(treeKey(open, 0, "End")).toEqual({ focus: 3 });
  });

  it("opens, steps in, closes and steps out", () => {
    expect(treeKey(flatten(roots, new Set()), 0, "ArrowRight")).toEqual({ expand: "src" });
    expect(treeKey(open, 0, "ArrowRight")).toEqual({ focus: 1 });
    expect(treeKey(open, 0, "ArrowLeft")).toEqual({ collapse: "src" });
    expect(treeKey(open, 1, "ArrowLeft")).toEqual({ focus: 0 });
    expect(treeKey(open, 3, "ArrowLeft")).toBeNull();
    expect(treeKey(open, 1, "ArrowRight")).toBeNull();
  });

  it("activates and jumps by first letter", () => {
    expect(treeKey(open, 1, "Enter")).toEqual({ activate: "src/a.ts" });
    expect(treeKey(open, 0, "r")).toEqual({ focus: 3 });
    expect(treeKey(open, 3, "s")).toEqual({ focus: 0 });
    expect(treeKey(open, 0, "z")).toBeNull();
  });
});

describe("ancestorsOf", () => {
  it("lists the branches above a node", () => {
    expect(ancestorsOf(roots, "src/a.ts")).toEqual(["src"]);
    expect(ancestorsOf(roots, "src")).toEqual([]);
    expect(ancestorsOf(roots, "missing")).toBeNull();
  });
});

describe("isWithin", () => {
  it("refuses a folder and its descendants, not its siblings", () => {
    expect(isWithin("src", "src")).toBe(true);
    expect(isWithin("src", "src/lib/x")).toBe(true);
    expect(isWithin("src", "src2")).toBe(false);
  });
});
