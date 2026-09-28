import { describe, expect, it } from "vitest";
import {
  closeTab,
  type Detail,
  detailTitle,
  encodeDetail,
  keepTabs,
  NO_TABS,
  openTab,
  parseDetail,
  parseView,
  pinTab,
  readTabs,
  setTabDirty,
  viewParam,
  writeTabs,
} from "./workspaceLayout.js";

describe("views", () => {
  it("defaults to source control and keeps the terminal address", () => {
    expect(parseView(null)).toBe("source");
    expect(parseView("terminal")).toBe("terminal");
    expect(parseView("nonsense")).toBe("source");
    expect(viewParam("source")).toBeNull();
    expect(viewParam("explorer")).toBe("explorer");
  });
});

describe("details", () => {
  const cases: Detail[] = [
    { kind: "file", path: "src/a:b.ts" },
    { kind: "diff", area: "staged", path: "src/x.ts" },
    { kind: "diffall", area: "working" },
    { kind: "commit", oid: "abc1234" },
    { kind: "commitdiff", oid: "abc1234" },
    { kind: "commitfile", oid: "abc1234", path: "a/b.txt" },
    { kind: "range", base: "origin/main" },
  ];

  it("round-trips every kind, paths with colons included", () => {
    for (const detail of cases) {
      expect(parseDetail(encodeDetail(detail))).toEqual(detail);
    }
  });

  it("refuses what it cannot read", () => {
    expect(parseDetail(null)).toBeNull();
    expect(parseDetail("diff:nowhere:x")).toBeNull();
    expect(parseDetail("commit:not-hex")).toBeNull();
    expect(parseDetail("file:")).toBeNull();
    expect(parseDetail("other:x")).toBeNull();
  });

  it("names a detail by its file or its commit", () => {
    expect(detailTitle({ kind: "file", path: "src/a.ts" })).toBe("a.ts");
    expect(detailTitle({ kind: "commit", oid: "abcdef0123" })).toBe("abcdef0");
    expect(detailTitle({ kind: "diffall", area: "staged" })).toBe("Staged changes");
  });
});

describe("open tabs", () => {
  const a: Detail = { kind: "file", path: "a" };
  const b: Detail = { kind: "file", path: "b" };
  const c: Detail = { kind: "file", path: "c" };

  it("replaces a preview and keeps a pinned tab", () => {
    let state = openTab(NO_TABS, a);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["file:a"]);
    state = openTab(state, b);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["file:b"]);
    state = pinTab(state, "file:b");
    state = openTab(state, c);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["file:b", "file:c"]);
    expect(state.active).toBe("file:c");
  });

  it("brings an open tab forward and pins it on demand", () => {
    let state = openTab(openTab(NO_TABS, a, true), b, true);
    state = openTab(state, a);
    expect(state.active).toBe("file:a");
    expect(state.tabs).toHaveLength(2);
    state = openTab(openTab(NO_TABS, a), a, true);
    expect(state.tabs[0]?.pinned).toBe(true);
  });

  it("keeps a dirty preview rather than replacing it", () => {
    let state = setTabDirty(openTab(NO_TABS, a), "file:a", true);
    state = openTab(state, b);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["file:a", "file:b"]);
    expect(state.tabs[0]?.pinned).toBe(true);
  });

  it("closes onto the neighbour", () => {
    let state = openTab(openTab(openTab(NO_TABS, a, true), b, true), c, true);
    state = closeTab(state, "file:c");
    expect(state.active).toBe("file:b");
    state = closeTab(state, "file:a");
    expect(state.active).toBe("file:b");
    expect(closeTab(state, "missing")).toBe(state);
  });

  it("drops tabs that no longer apply, except dirty ones", () => {
    let state = openTab(openTab(NO_TABS, a, true), b, true);
    state = setTabDirty(state, "file:a", true);
    state = keepTabs(state, () => false);
    expect(state.tabs.map((tab) => tab.id)).toEqual(["file:a"]);
    expect(state.active).toBe("file:a");
  });

  it("survives storage, without dirtiness", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const state = setTabDirty(openTab(openTab(NO_TABS, a, true), b), "file:a", true);
    writeTabs(storage, "main", state);
    const back = readTabs(storage, "main");
    expect(back.tabs.map((tab) => [tab.id, tab.pinned, tab.dirty])).toEqual([
      ["file:a", true, false],
      ["file:b", false, false],
    ]);
    expect(back.active).toBe("file:b");
    expect(readTabs(storage, "other")).toEqual(NO_TABS);
    store.set("exeora.workspace_tabs.bad", "{not json");
    expect(readTabs(storage, "bad")).toEqual(NO_TABS);
  });
});
