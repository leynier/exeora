import { describe, expect, it } from "vitest";
import type { Project, ProjectLocation, Workspace } from "./api-types.js";
import {
  callPlace,
  callPlaceLabel,
  canonicalSelector,
  needsWorkspaces,
  otherRootLabel,
  parseSelector,
  projectsToAsk,
  rootIsOpen,
  rootSelectorOf,
  workspacesAt,
} from "./selectors.js";

const location = (patch: Partial<ProjectLocation>): ProjectLocation => ({
  id: "loc_laptop",
  kind: "local",
  deviceId: "dev_laptop",
  name: "Laptop",
  slug: "laptop",
  localPath: "/work/widgets",
  status: "ready",
  error: null,
  errorCode: null,
  default: true,
  online: true,
  state: "online",
  createdAt: 1,
  ...patch,
});

const laptop = location({});
const desktop = location({
  id: "loc_desktop",
  deviceId: "dev_desktop",
  name: "Desktop",
  slug: "desktop",
  localPath: "/srv/widgets",
  default: false,
});
const cloud = location({
  id: "loc_cloud",
  kind: "cloud",
  deviceId: "dev_cloud_root",
  name: "Exeora Cloud",
  slug: "cloud",
  localPath: null,
  default: false,
  state: "asleep",
});

const project = {
  deviceId: "dev_laptop",
  defaultBranch: "master",
  cloud: null,
  locations: [laptop, desktop, cloud],
} as unknown as Project;

const workspace = (patch: Partial<Workspace>): Workspace => ({
  id: "wsp_login",
  projectId: "prj_widgets",
  slug: "fix-login",
  name: "fix/login",
  branch: "fix/login",
  localPath: "/work/widgets/.worktrees/fix-login",
  managed: true,
  deviceId: "dev_laptop",
  cloud: false,
  machine: "Laptop",
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const onDesktop = workspace({
  id: "wsp_hotfix",
  slug: "hotfix-desktop",
  branch: "hotfix",
  deviceId: "dev_desktop",
  machine: "Desktop",
});
const onCloud = workspace({
  id: "wsp_search",
  slug: "feature-search",
  branch: "feature/search",
  deviceId: "dev_cloud_search",
  cloud: true,
  machine: "widgets-feature-search",
});

describe("parseSelector", () => {
  it("reads nothing and `main` as the root of the default location", () => {
    expect(parseSelector(null)).toEqual({ root: true, location: null });
    expect(parseSelector(undefined)).toEqual({ root: true, location: null });
    expect(parseSelector("")).toEqual({ root: true, location: null });
    expect(parseSelector("main")).toEqual({ root: true, location: null });
  });

  it("reads `main@<slug>` as the root of that location", () => {
    expect(parseSelector("main@desktop")).toEqual({ root: true, location: "desktop" });
    expect(parseSelector("main@cloud")).toEqual({ root: true, location: "cloud" });
    expect(parseSelector(" MAIN@Desktop ")).toEqual({ root: true, location: "desktop" });
  });

  it("reads anything else as the slug of a workspace", () => {
    expect(parseSelector("fix-login")).toEqual({ root: false, slug: "fix-login" });
    // A slug that merely starts like the root is a slug.
    expect(parseSelector("main-menu")).toEqual({ root: false, slug: "main-menu" });
    expect(parseSelector("mainframe")).toEqual({ root: false, slug: "mainframe" });
    expect(parseSelector("main@")).toEqual({ root: false, slug: "main@" });
  });
});

describe("rootSelectorOf", () => {
  it("needs no selector in the default location and names any other", () => {
    expect(rootSelectorOf(laptop)).toBeNull();
    expect(rootSelectorOf(desktop)).toBe("main@desktop");
    expect(rootSelectorOf(cloud)).toBe("main@cloud");
  });
});

describe("canonicalSelector", () => {
  it("gives the root of the default location one name, however it was asked for", () => {
    expect(canonicalSelector(null, project)).toBeNull();
    expect(canonicalSelector("main", project)).toBeNull();
    expect(canonicalSelector("main@laptop", project)).toBeNull();
  });

  it("keeps the root of another location and the slug of a workspace as they are", () => {
    expect(canonicalSelector("main@desktop", project)).toBe("main@desktop");
    expect(canonicalSelector("fix-login", project)).toBe("fix-login");
  });

  it("keeps a location it does not know, for the page to say it is not there", () => {
    expect(canonicalSelector("main@old-box", project)).toBe("main@old-box");
    expect(canonicalSelector("main@desktop", undefined)).toBe("main@desktop");
  });
});

describe("rootIsOpen", () => {
  it("opens a machine that has cloned and Cloud that runs the root", () => {
    expect(rootIsOpen(laptop)).toBe(true);
    expect(rootIsOpen(cloud)).toBe(true);
  });

  it("does not open a location that holds no copy, or whose machine was removed", () => {
    expect(rootIsOpen({ ...desktop, status: "pending", state: "not cloned" })).toBe(false);
    expect(rootIsOpen({ ...cloud, deviceId: null })).toBe(false);
    expect(rootIsOpen({ ...desktop, state: "removed" })).toBe(false);
  });
});

describe("workspacesAt", () => {
  const all = [workspace({}), onDesktop, onCloud, workspace({ id: "wsp_old", deviceId: null })];

  it("keeps the workspaces on the machine of the location, and no others", () => {
    expect(workspacesAt(project, desktop, all).map((entry) => entry.id)).toEqual(["wsp_hotfix"]);
    // One older than locations has no machine of its own and is the default's.
    expect(workspacesAt(project, laptop, all).map((entry) => entry.id)).toEqual([
      "wsp_login",
      "wsp_old",
    ]);
  });

  it("shares a machine with nothing on Exeora Cloud but the workspace itself", () => {
    expect(workspacesAt(project, cloud, all)).toEqual([]);
    expect(workspacesAt(project, cloud, all, onCloud)).toEqual([onCloud]);
  });

  it("has nothing to say for a location that is not known", () => {
    expect(workspacesAt(project, undefined, all)).toEqual([]);
  });
});

describe("callPlace", () => {
  const workspaces = [workspace({}), onCloud];

  it("names the root by the default branch and the location by its name", () => {
    expect(callPlace("main@desktop", project, workspaces)).toEqual({
      label: "master · default branch",
      where: "Desktop",
    });
    expect(callPlaceLabel("main@cloud", project)).toBe("master · default branch · Exeora Cloud");
  });

  it("shows the slug of a location that is not there any more", () => {
    expect(callPlaceLabel("main@old-box", project)).toBe("master · default branch · old-box");
    expect(callPlaceLabel("main@desktop", undefined)).toBe("default branch · desktop");
  });

  it("names a workspace by its branch and the machine that holds it", () => {
    expect(callPlace("fix-login", project, workspaces)).toEqual({
      label: "fix/login",
      where: "Laptop",
    });
  });

  it("says Exeora Cloud for an instance, whose own name means nothing to a person", () => {
    expect(callPlaceLabel("feature-search", project, workspaces)).toBe(
      "feature/search · Exeora Cloud",
    );
  });

  it("shows the slug alone for a workspace that no longer exists", () => {
    expect(callPlace("gone", project, workspaces)).toEqual({ label: "gone", where: null });
    expect(callPlaceLabel("fix-login", project)).toBe("fix-login");
  });

  it("shows an older row, which kept no location, as it always was", () => {
    expect(callPlaceLabel(null, project, workspaces)).toBe("master · default branch");
    expect(callPlaceLabel("main", project, workspaces)).toBe("master · default branch");
  });

  it("leaves the machine out when the gateway did not name one", () => {
    expect(callPlaceLabel("fix-login", project, [workspace({ machine: null })])).toBe("fix/login");
  });
});

describe("projectsToAsk", () => {
  const call = (projectId: string, workspaceSlug: string | null) => ({ projectId, workspaceSlug });
  const projects = [{ id: "prj_a" }, { id: "prj_b" }, { id: "prj_c" }];

  it("asks once for each project that has a call in a workspace", () => {
    expect(
      projectsToAsk(
        [call("prj_b", "fix-login"), call("prj_b", "other"), call("prj_a", "fix-login")],
        projects,
      ),
    ).toEqual(["prj_a", "prj_b"]);
  });

  it("asks nothing for calls in a root, which say where they ran by themselves", () => {
    expect(needsWorkspaces("main@desktop")).toBe(false);
    expect(needsWorkspaces(null)).toBe(false);
    expect(needsWorkspaces("fix-login")).toBe(true);
    expect(projectsToAsk([call("prj_a", "main@desktop"), call("prj_b", null)], projects)).toEqual(
      [],
    );
  });

  it("asks nothing of a project that is gone", () => {
    expect(projectsToAsk([call("prj_gone", "fix-login")], projects)).toEqual([]);
  });
});

describe("otherRootLabel", () => {
  it("names the root of another location by the location", () => {
    expect(otherRootLabel(desktop)).toBe("root · Desktop");
  });
});
