import { describe, expect, it } from "vitest";
import type { GitFileState } from "../../api.js";
import { primaryAction } from "./primaryAction.js";

const file = (index: string, worktree: string, kind: GitFileState["kind"] = "tracked") =>
  ({ path: "a", index, worktree, kind, submodule: false }) as GitFileState;

const base = {
  files: [],
  upstream: "origin/main",
  head: "main",
  ahead: 0,
  behind: 0,
  remotes: ["origin"],
};

describe("primaryAction", () => {
  it("commits what is staged, once there is a message", () => {
    const status = { ...base, files: [file("M", ".")] };
    expect(primaryAction(status, false)).toMatchObject({ id: "commit", disabled: true });
    expect(primaryAction(status, true)).toEqual({
      id: "commit",
      label: "Commit 1 file",
      disabled: false,
    });
  });

  it("only fetches while there are conflicts", () => {
    const status = { ...base, files: [file("U", "U", "conflict"), file("M", ".")], ahead: 2 };
    expect(primaryAction(status, true).id).toBe("fetch");
  });

  it("publishes a branch without an upstream when there is a remote", () => {
    expect(primaryAction({ ...base, upstream: null }, false).id).toBe("publish");
    expect(primaryAction({ ...base, upstream: null, remotes: [] }, false).id).toBe("fetch");
    expect(primaryAction({ ...base, upstream: null, head: null }, false).id).toBe("fetch");
  });

  it("syncs, pulls or pushes by the upstream's distance", () => {
    expect(primaryAction({ ...base, ahead: 1, behind: 2 }, false)).toMatchObject({
      id: "sync",
      label: "Sync 2↓ 1↑",
    });
    expect(primaryAction({ ...base, behind: 2 }, false).label).toBe("Pull 2");
    expect(primaryAction({ ...base, ahead: 3 }, false).label).toBe("Push 3");
  });

  it("stages what changed when there is nothing to send", () => {
    expect(primaryAction({ ...base, files: [file(".", "M")] }, false).id).toBe("stage_all");
    expect(primaryAction({ ...base, files: [file(".", ".", "untracked")] }, false).id).toBe(
      "stage_all",
    );
  });
});
