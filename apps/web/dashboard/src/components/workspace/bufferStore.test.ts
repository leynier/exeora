import { afterEach, describe, expect, it } from "vitest";
import { bufferStore } from "./bufferStore.js";
import { configureWorkspaceScope } from "./scope.js";

afterEach(() => configureWorkspaceScope(""));

describe("bufferStore", () => {
  it("keeps edits per project and working copy", () => {
    bufferStore.set("p1", "main", "src/a.ts", { text: "edited", token: "t1" });
    bufferStore.set("p1", "w1", "src/a.ts", { text: "other", token: "t2" });
    bufferStore.set("p2", "main", "src/b.ts", { text: "elsewhere", token: "t3" });

    expect(bufferStore.get("p1", "main", "src/a.ts")).toEqual({ text: "edited", token: "t1" });
    expect(bufferStore.dirtyPaths("p1", "main")).toEqual(["src/a.ts"]);
    expect(bufferStore.dirtyPaths("p1", "w1")).toEqual(["src/a.ts"]);
    expect(bufferStore.dirtyPaths("p2", "main")).toEqual(["src/b.ts"]);

    bufferStore.clear("p1", "main", "src/a.ts");
    expect(bufferStore.dirtyPaths("p1", "main")).toEqual([]);
    bufferStore.clear("p1", "w1", "src/a.ts");
    bufferStore.clear("p2", "main", "src/b.ts");
  });

  it("keeps one panel instance's edits from another's", () => {
    configureWorkspaceScope("panel-a");
    bufferStore.set("p1", "main", "x.ts", { text: "a", token: "t" });
    configureWorkspaceScope("panel-b");
    expect(bufferStore.get("p1", "main", "x.ts")).toBeUndefined();
    expect(bufferStore.dirtyPaths("p1", "main")).toEqual([]);
    configureWorkspaceScope("panel-a");
    expect(bufferStore.dirtyPaths("p1", "main")).toEqual(["x.ts"]);
    bufferStore.clear("p1", "main", "x.ts");
  });
});
