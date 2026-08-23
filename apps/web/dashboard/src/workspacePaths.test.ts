import { describe, expect, it } from "vitest";
import { projectRootBranch, terminalSessionKey, worktreeSlugForBranch } from "./workspacePaths.js";

const project = "/work/e2e";
const worktrees = [{ slug: "feature-trees", localPath: "/work/e2e/.worktrees/feature-trees" }];
const gitWorktrees = [
  { path: "/work/e2e", branch: "develop" },
  { path: "/work/e2e/.worktrees/feature-trees", branch: "feature/trees" },
];

describe("worktreeSlugForBranch", () => {
  it("sends the project root even when that checkout is not named main", () => {
    expect(worktreeSlugForBranch("develop", gitWorktrees, project, worktrees)).toBeNull();
  });

  it("routes a branch already checked out in a connected worktree", () => {
    expect(worktreeSlugForBranch("feature/trees", gitWorktrees, project, worktrees)).toBe(
      "feature-trees",
    );
  });

  it("does not treat a nested worktree path as the project root", () => {
    expect(worktreeSlugForBranch("develop", gitWorktrees, `${project}/`, worktrees)).toBeNull();
  });

  it("leaves unknown branches for an in-place switch", () => {
    expect(worktreeSlugForBranch("experiment", gitWorktrees, project, worktrees)).toBeUndefined();
  });
});

describe("projectRootBranch", () => {
  it("reads the project root branch from git worktrees, not the main slug", () => {
    expect(projectRootBranch(gitWorktrees, project, worktrees)).toBe("develop");
  });
});

describe("terminalSessionKey", () => {
  it("keeps the project root distinct from a named worktree", () => {
    expect(terminalSessionKey("prj_1")).toBe("prj_1:main");
    expect(terminalSessionKey("prj_1", "wtr_1")).toBe("prj_1:wtr_1");
  });
});
