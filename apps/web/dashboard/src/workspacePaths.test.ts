import { describe, expect, it } from "vitest";
import { projectRootBranch, terminalSessionKey, workspaceSlugForBranch } from "./workspacePaths.js";

const project = "/work/e2e";
const workspaces = [{ slug: "feature-trees", localPath: "/work/e2e/.workspaces/feature-trees" }];
const gitWorkspaces = [
  { path: "/work/e2e", branch: "develop" },
  { path: "/work/e2e/.workspaces/feature-trees", branch: "feature/trees" },
];

describe("workspaceSlugForBranch", () => {
  it("sends the project root even when that checkout is not named main", () => {
    expect(workspaceSlugForBranch("develop", gitWorkspaces, project, workspaces)).toBeNull();
  });

  it("routes a branch already checked out in a connected workspace", () => {
    expect(workspaceSlugForBranch("feature/trees", gitWorkspaces, project, workspaces)).toBe(
      "feature-trees",
    );
  });

  it("does not treat a nested workspace path as the project root", () => {
    expect(workspaceSlugForBranch("develop", gitWorkspaces, `${project}/`, workspaces)).toBeNull();
  });

  it("leaves unknown branches for an in-place switch", () => {
    expect(
      workspaceSlugForBranch("experiment", gitWorkspaces, project, workspaces),
    ).toBeUndefined();
  });
});

describe("projectRootBranch", () => {
  it("reads the project root branch from git workspaces, not the main slug", () => {
    expect(projectRootBranch(gitWorkspaces, project, workspaces)).toBe("develop");
  });
});

describe("terminalSessionKey", () => {
  it("keeps the project root distinct from a named workspace", () => {
    expect(terminalSessionKey("prj_1")).toBe("prj_1:main");
    expect(terminalSessionKey("prj_1", "wsp_1")).toBe("prj_1:wsp_1");
  });
});
