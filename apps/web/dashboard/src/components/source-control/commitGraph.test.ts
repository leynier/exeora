import { describe, expect, it } from "vitest";
import { commitGraph, parseRef } from "./commitGraph.js";

describe("commitGraph", () => {
  it("keeps a straight line on one lane", () => {
    const rows = commitGraph([
      { oid: "c", parents: ["b"] },
      { oid: "b", parents: ["a"] },
      { oid: "a", parents: [] },
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows[0]?.edges).toEqual([{ from: 0, to: 0 }]);
    expect(rows[2]?.edges).toEqual([]);
    expect(rows.every((row) => row.width === 1)).toBe(true);
  });

  it("opens a second lane at a merge and closes it where the branch started", () => {
    // m merges f into b; both descend from a.
    const rows = commitGraph([
      { oid: "m", parents: ["b", "f"] },
      { oid: "f", parents: ["a"] },
      { oid: "b", parents: ["a"] },
      { oid: "a", parents: [] },
    ]);
    expect(rows[0]).toMatchObject({
      lane: 0,
      edges: [
        { from: 0, to: 0 },
        { from: 0, to: 1 },
      ],
    });
    // f sits on lane 1, with b's line passing through on lane 0.
    expect(rows[1]).toMatchObject({ lane: 1, width: 2 });
    expect(rows[1]?.edges).toEqual([
      { from: 0, to: 0, through: true },
      { from: 1, to: 1 },
    ]);
    // b's first parent a is already awaited on lane 1, so lane 0 bends into it.
    expect(rows[2]).toMatchObject({ lane: 0 });
    expect(rows[2]?.edges).toEqual([
      { from: 1, to: 1, through: true },
      { from: 0, to: 1 },
    ]);
    expect(rows[3]).toMatchObject({ lane: 1, edges: [] });
  });

  it("gives an unrelated root its own lane", () => {
    const rows = commitGraph([
      { oid: "x", parents: [] },
      { oid: "y", parents: [] },
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0]);
  });
});

describe("parseRef", () => {
  it("tells HEAD, branches, remotes and tags apart", () => {
    expect(parseRef("HEAD -> main")).toEqual({ name: "main", kind: "head" });
    expect(parseRef("origin/main")).toEqual({ name: "origin/main", kind: "remote" });
    expect(parseRef("tag: v1.0")).toEqual({ name: "v1.0", kind: "tag" });
    expect(parseRef("feature")).toEqual({ name: "feature", kind: "branch" });
  });
});
