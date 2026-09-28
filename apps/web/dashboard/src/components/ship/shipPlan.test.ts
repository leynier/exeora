import { describe, expect, it } from "vitest";
import type { GitFileState } from "../../api.js";
import { branchFromSubject, shipPlan } from "./shipPlan.js";

const file = (
  index: string,
  worktree: string,
  kind: GitFileState["kind"] = "tracked",
): GitFileState => ({ path: "a", index, worktree, kind, submodule: false }) as GitFileState;

describe("shipPlan", () => {
  it("stages, commits, branches and opens, as the state asks", () => {
    const plan = shipPlan(
      { files: [file(".", "M")], head: "main", upstream: "origin/main", remotes: ["origin"] },
      "main",
    );
    expect(plan.steps).toEqual([
      "stage",
      "commit_message",
      "branch",
      "commit",
      "pr_text",
      "push",
      "pull_request",
    ]);
    expect(plan.onBase).toBe(true);
  });

  it("skips staging with everything staged, and the branch off the base", () => {
    const plan = shipPlan(
      { files: [file("M", ".")], head: "feature", upstream: null, remotes: ["origin"] },
      "main",
    );
    expect(plan.steps).toEqual(["commit_message", "commit", "pr_text", "push", "pull_request"]);
  });

  it("only pushes and opens with a clean tree", () => {
    const plan = shipPlan(
      { files: [], head: "feature", upstream: null, remotes: ["origin"] },
      "main",
    );
    expect(plan.steps).toEqual(["pr_text", "push", "pull_request"]);
    expect(plan.hasChanges).toBe(false);
  });
});

describe("branchFromSubject", () => {
  it("slugs and avoids names already taken", () => {
    expect(branchFromSubject("Fix the Login flow!", [])).toBe("fix-the-login-flow");
    expect(branchFromSubject("Fix", ["fix", "fix-2"])).toBe("fix-3");
    expect(branchFromSubject("***", [])).toBe("changes");
    expect(branchFromSubject("a".repeat(80), []).length).toBeLessThanOrEqual(48);
  });
});
