import { describe, expect, it } from "vitest";
import {
  listedTerminalTarget,
  projectRootBranch,
  terminalSessionKey,
  workspaceSlugForBranch,
} from "./workspacePaths.js";

const project = { path: "/work/e2e", selector: null };
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
    expect(
      workspaceSlugForBranch(
        "develop",
        gitWorkspaces,
        { path: `${project.path}/`, selector: null },
        workspaces,
      ),
    ).toBeNull();
  });

  it("sends the root of another location to that location, not to the default one", () => {
    const desktop = { path: "/srv/e2e", selector: "main@desktop" };
    const there = [
      { path: "/srv/e2e", branch: "release" },
      { path: "/srv/e2e/.workspaces/hotfix", branch: "hotfix" },
    ];
    const onDesktop = [{ slug: "hotfix-desktop", localPath: "/srv/e2e/.workspaces/hotfix" }];

    expect(workspaceSlugForBranch("release", there, desktop, onDesktop)).toBe("main@desktop");
    expect(workspaceSlugForBranch("hotfix", there, desktop, onDesktop)).toBe("hotfix-desktop");
  });

  it("does not take a path on another machine for the one in this status", () => {
    // The laptop has a workspace at the same path the desktop's status lists.
    // It is given no workspaces of the laptop, so it finds none.
    const there = [{ path: "/work/e2e/.workspaces/feature-trees", branch: "feature/trees" }];
    expect(
      workspaceSlugForBranch(
        "feature/trees",
        there,
        { path: "/srv/e2e", selector: "main@desktop" },
        [],
      ),
    ).toBeUndefined();
  });

  it("finds no root for a location whose path is not known", () => {
    const blank = [{ path: "", branch: "develop" }];
    expect(
      workspaceSlugForBranch("develop", blank, { path: "", selector: "main@cloud" }, []),
    ).toBeUndefined();
  });

  it("leaves unknown branches for an in-place switch", () => {
    expect(
      workspaceSlugForBranch("experiment", gitWorkspaces, project, workspaces),
    ).toBeUndefined();
  });
});

describe("projectRootBranch", () => {
  it("reads the project root branch from git workspaces, not the main slug", () => {
    expect(projectRootBranch(gitWorkspaces, project.path, workspaces)).toBe("develop");
  });

  it("says nothing about a root whose path is not known", () => {
    expect(projectRootBranch(gitWorkspaces, "", workspaces)).toBeNull();
  });
});

describe("terminalSessionKey", () => {
  it("keeps the project root distinct from a named workspace", () => {
    expect(terminalSessionKey("prj_1")).toBe("prj_1:main");
    expect(terminalSessionKey("prj_1", "wsp_1")).toBe("prj_1:wsp_1");
  });

  it("keeps the root of another location apart from the default one's", () => {
    expect(terminalSessionKey("prj_1", "main@desktop")).toBe("prj_1:main@desktop");
    expect(terminalSessionKey("prj_1", null)).toBe("prj_1:main");
    expect(terminalSessionKey("prj_1", "")).toBe("prj_1:main");
  });
});

describe("listedTerminalTarget", () => {
  it("names a workspace by its id, whatever its slug is", () => {
    expect(listedTerminalTarget({ workspaceId: "wsp_1", workspaceSlug: "fix-login" })).toBe(
      "wsp_1",
    );
  });

  it("does not take a terminal with no workspace id for the default location's", () => {
    expect(listedTerminalTarget({ workspaceSlug: "main@desktop" })).toBe("main@desktop");
    expect(listedTerminalTarget({ workspaceSlug: "MAIN@Desktop" })).toBe("main@desktop");
  });

  it("is the default location's root only when no location is named", () => {
    expect(listedTerminalTarget({})).toBeUndefined();
    expect(listedTerminalTarget({ workspaceSlug: "main" })).toBeUndefined();
  });
});
