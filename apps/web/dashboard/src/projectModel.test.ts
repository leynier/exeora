import { describe, expect, it } from "vitest";
import type { CloudInstance, LocalMachine, Machine } from "./api-projects.js";
import type { Project, ProjectLocation, Workspace } from "./api-types.js";
import {
  callWorkspaceLabel,
  defaultBranchOf,
  deletionImpact,
  groupByLocation,
  holdsRoot,
  isLeaving,
  isOlderCli,
  livesOnlyOnCloud,
  repositoryLabel,
  rootLabel,
  workspaceCount,
  workspaceHref,
  workspaceLabel,
  workspaceOptions,
} from "./projectModel.js";

const location = (patch: Partial<ProjectLocation>): ProjectLocation => ({
  id: "loc_laptop",
  kind: "local",
  deviceId: "dev_laptop",
  name: "laptop",
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
  name: "desktop",
  slug: "desktop",
  localPath: null,
  status: "pending",
  default: false,
  state: "not cloned",
});
const cloud = location({
  id: "loc_cloud",
  kind: "cloud",
  deviceId: "dev_cloud_root",
  name: "Exeora Cloud",
  slug: "cloud",
  localPath: null,
  default: false,
  online: false,
  state: "asleep",
});

const project = (patch: Partial<Project> = {}): Project => ({
  id: "prj_widgets",
  slug: "widgets",
  name: "Widgets",
  deviceId: "dev_laptop",
  localPath: "/work/widgets",
  repoUrl: "https://github.com/example/widgets.git",
  defaultBranch: "master",
  locations: [laptop, desktop, cloud],
  mcpUrl: "https://exeora.test/p/prj_widgets/mcp",
  policy: { mode: "allow_all", allow: [], deny: [], shell: true, approve: false, tools: null },
  createdAt: 1,
  cloud: {
    repoUrl: "https://github.com/example/widgets.git",
    defaultBranch: "master",
    hasCredential: false,
  },
  github: null,
  ...patch,
});

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
  machine: "laptop",
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const instance = (patch: Partial<CloudInstance>): CloudInstance => ({
  deviceId: "dev_cloud_root",
  kind: "cloud",
  name: "widgets-main",
  platform: "linux",
  cliVersion: "0.18.0",
  online: false,
  state: "asleep",
  lastSeenAt: 1,
  createdAt: 1,
  revokedAt: null,
  project: { id: "prj_widgets", slug: "widgets", name: "Widgets" },
  workspace: { id: null, slug: "main", branch: "master" },
  status: "ready",
  step: null,
  error: null,
  errorCode: null,
  errorDetail: null,
  readyAt: 1,
  runtime: null,
  ...patch,
});

describe("rootLabel", () => {
  it("names the project root by its real branch, marked as the default", () => {
    expect(rootLabel("master")).toBe("master · default branch");
    expect(rootLabel("main")).toBe("main · default branch");
  });

  it("falls back to the mark alone for a directory with no branch known", () => {
    expect(rootLabel(null)).toBe("default branch");
    expect(rootLabel(undefined)).toBe("default branch");
  });
});

describe("defaultBranchOf", () => {
  it("prefers the project's own branch and falls back to what Cloud was given", () => {
    expect(defaultBranchOf(project())).toBe("master");
    expect(defaultBranchOf(project({ defaultBranch: null }))).toBe("master");
    expect(defaultBranchOf(project({ defaultBranch: null, cloud: null }))).toBeNull();
    expect(defaultBranchOf(undefined)).toBeNull();
  });
});

describe("workspace labels", () => {
  it("names a workspace by its branch and a detached one by its slug", () => {
    expect(workspaceLabel({ branch: "fix/login", slug: "fix-login" })).toBe("fix/login");
    expect(workspaceLabel({ branch: null, slug: "fix-login" })).toBe("fix-login");
  });

  it("turns the `main` of the log into the default branch", () => {
    const workspaces = [workspace({})];
    expect(callWorkspaceLabel(null, project(), workspaces)).toBe("master · default branch");
    expect(callWorkspaceLabel("main", project(), workspaces)).toBe("master · default branch");
    expect(callWorkspaceLabel("fix-login", project(), workspaces)).toBe("fix/login");
    expect(callWorkspaceLabel("gone", project(), workspaces)).toBe("gone");
  });

  it("links the root without a selector and a workspace by its slug", () => {
    expect(workspaceHref("prj_1", null)).toBe("/workspace?project=prj_1");
    expect(workspaceHref("prj_1", "fix-login")).toBe(
      "/workspace?project=prj_1&workspace=fix-login",
    );
  });
});

describe("repositoryLabel", () => {
  it("reads a remote as host, owner and name", () => {
    expect(repositoryLabel("https://github.com/example/widgets.git")).toBe(
      "github.com/example/widgets",
    );
    expect(repositoryLabel("git@github.com:example/widgets.git")).toBe(
      "github.com/example/widgets",
    );
    expect(repositoryLabel("https://git.example.com/team/sub/repo")).toBe(
      "git.example.com/team/sub/repo",
    );
  });

  it("has nothing to say for a directory without a repository", () => {
    expect(repositoryLabel(null)).toBeNull();
    expect(repositoryLabel("")).toBeNull();
  });
});

describe("isOlderCli", () => {
  it("compares versions by number, not by text", () => {
    expect(isOlderCli("0.17.9", "0.18.0")).toBe(true);
    expect(isOlderCli("0.9.0", "0.18.0")).toBe(true);
    expect(isOlderCli("0.18.0", "0.18.0")).toBe(false);
    expect(isOlderCli("0.18.1", "0.18.0")).toBe(false);
    expect(isOlderCli("1.0.0", "0.18.0")).toBe(false);
    expect(isOlderCli("v0.18.0-beta.1", "0.18.0")).toBe(false);
  });

  it("takes a CLI that never said its version as older", () => {
    expect(isOlderCli(null, "0.18.0")).toBe(true);
  });
});

describe("holdsRoot", () => {
  it("is a machine that has cloned, or Cloud with an instance for the root", () => {
    expect(holdsRoot(laptop)).toBe(true);
    expect(holdsRoot(desktop)).toBe(false);
    expect(holdsRoot(cloud)).toBe(true);
    expect(holdsRoot({ ...cloud, deviceId: null })).toBe(false);
  });
});

describe("livesOnlyOnCloud", () => {
  it("is true only when no machine of the person holds the project", () => {
    expect(livesOnlyOnCloud(project({ locations: [cloud] }))).toBe(true);
    expect(livesOnlyOnCloud(project())).toBe(false);
    expect(livesOnlyOnCloud(project({ locations: [] }))).toBe(false);
  });
});

describe("groupByLocation", () => {
  const onCloud = workspace({
    id: "wsp_cloud",
    slug: "feature-search",
    name: "feature/search",
    branch: "feature/search",
    deviceId: "dev_cloud_search",
    cloud: true,
    machine: "widgets-feature-search",
  });
  const machines = [
    instance({}),
    instance({
      deviceId: "dev_cloud_search",
      state: "setting up",
      status: "creating",
      workspace: { id: "wsp_cloud", slug: "feature-search", branch: "feature/search" },
    }),
  ];

  it("puts each workspace under the location it is in, the root first", () => {
    const tree = groupByLocation(
      project(),
      [workspace({ id: "wsp_z", slug: "zebra", branch: "zebra" }), workspace({}), onCloud],
      machines,
    );

    expect(tree.groups.map((group) => group.location.name)).toEqual([
      "laptop",
      "desktop",
      "Exeora Cloud",
    ]);
    expect(tree.groups[0]?.entries.map((entry) => entry.label)).toEqual([
      "master · default branch",
      "fix/login",
      "zebra",
    ]);
    expect(tree.groups[1]?.entries).toEqual([]);
    expect(tree.groups[2]?.entries.map((entry) => entry.label)).toEqual([
      "master · default branch",
      "feature/search",
    ]);
    expect(tree.unplaced).toEqual([]);
  });

  it("gives an instance its own state and a workspace on a machine none", () => {
    const tree = groupByLocation(project(), [workspace({}), onCloud], machines);
    const local = tree.groups[0]?.entries[1];
    const search = tree.groups[2]?.entries[1];

    expect(local).toMatchObject({ state: null, instance: null, openable: true });
    expect(search).toMatchObject({ state: "setting up", openable: false });
    expect(search?.instance?.deviceId).toBe("dev_cloud_search");
  });

  it("opens the root only in the default location", () => {
    const tree = groupByLocation(project(), [], machines);
    expect(tree.groups[0]?.entries[0]).toMatchObject({ root: true, slug: null, openable: true });
    expect(tree.groups[2]?.entries[0]).toMatchObject({
      root: true,
      state: "asleep",
      openable: false,
    });
  });

  it("lists an instance that is being set up before its workspace is", () => {
    const tree = groupByLocation(project(), [], machines);
    expect(tree.groups[2]?.entries.map((entry) => [entry.label, entry.state])).toEqual([
      ["master · default branch", "asleep"],
      ["feature/search", "setting up"],
    ]);
  });

  it("shows no root under Cloud while it holds only workspaces", () => {
    const tree = groupByLocation(
      project({ locations: [laptop, { ...cloud, deviceId: null }] }),
      [onCloud],
      machines.slice(1),
    );
    expect(tree.groups[1]?.entries.map((entry) => entry.label)).toEqual(["feature/search"]);
  });

  it("reads a workspace older than locations as the default machine's", () => {
    const tree = groupByLocation(project(), [workspace({ deviceId: null })], []);
    expect(tree.groups[0]?.entries.map((entry) => entry.label)).toEqual([
      "master · default branch",
      "fix/login",
    ]);
  });

  it("keeps a workspace on a machine that is no location apart, not under a wrong one", () => {
    const tree = groupByLocation(project(), [workspace({ deviceId: "dev_gone" })], []);
    expect(tree.unplaced.map((entry) => entry.label)).toEqual(["fix/login"]);
    expect(tree.groups[0]?.entries.map((entry) => entry.label)).toEqual([
      "master · default branch",
    ]);
  });
});

describe("deletionImpact", () => {
  const held = (projectId: string, name: string) => ({
    projectId,
    slug: name.toLowerCase(),
    name,
    localPath: `/work/${name.toLowerCase()}`,
    status: "ready" as const,
    error: null,
    default: true,
    workspaces: 0,
  });
  const machine: Pick<LocalMachine, "deviceId" | "projects"> = {
    deviceId: "dev_laptop",
    projects: [held("prj_widgets", "Widgets"), held("prj_solo", "Solo"), held("prj_half", "Half")],
  };

  it("deletes what lives only there and keeps what has another location", () => {
    const impact = deletionImpact(machine, [
      project(),
      project({ id: "prj_solo", locations: [laptop] }),
      // Cloud holding only workspaces still keeps the project: the gateway
      // starts an instance for the root there before the machine goes.
      project({ id: "prj_half", locations: [laptop, { ...cloud, deviceId: null }] }),
    ]);

    expect(impact.surviving.map((entry) => entry.name)).toEqual(["Widgets", "Half"]);
    expect(impact.deleted.map((entry) => entry.name)).toEqual(["Solo"]);
  });

  it("does not count a location whose machine was removed", () => {
    const impact = deletionImpact(machine, [
      project({ locations: [laptop, { ...desktop, state: "removed" }] }),
    ]);
    expect(impact.deleted.map((entry) => entry.name)).toContain("Widgets");
  });
});

describe("workspaceOptions", () => {
  const onCloud = workspace({
    id: "wsp_cloud",
    slug: "feature-search",
    branch: "feature/search",
    deviceId: "dev_cloud_search",
    cloud: true,
  });
  const settingUp = instance({
    deviceId: "dev_cloud_search",
    state: "setting up",
    status: "creating",
    workspace: { id: "wsp_cloud", slug: "feature-search", branch: "feature/search" },
  });

  it("reads each workspace as its branch and its location, the root as the default", () => {
    const options = workspaceOptions(
      project(),
      [workspace({}), onCloud],
      [instance({}), { ...settingUp, state: "asleep", status: "ready" }],
    );
    expect(options).toEqual([
      { value: "main", label: "master · default branch · laptop" },
      { value: "fix-login", label: "fix/login · laptop" },
      { value: "feature-search", label: "feature/search · Exeora Cloud" },
    ]);
  });

  it("prefers the branch the root is really on", () => {
    const [root] = workspaceOptions(project(), [], [], "release");
    expect(root?.label).toBe("release · default branch · laptop");
  });

  it("lists an instance that is being set up with its state, out of reach", () => {
    const options = workspaceOptions(project(), [onCloud], [instance({}), settingUp]);
    expect(options.at(-1)).toEqual({
      value: "feature-search",
      label: "feature/search · Exeora Cloud",
      hint: "setting up",
      disabled: true,
    });
  });

  it("keeps a failed instance within reach, so the failure can be read and retried", () => {
    const options = workspaceOptions(
      project(),
      [onCloud],
      [{ ...settingUp, state: "failed", status: "error" }],
    );
    expect(options.at(-1)).toMatchObject({ hint: "failed", disabled: false });
  });
});

describe("workspaceCount and isLeaving", () => {
  const machines = [
    {
      deviceId: "dev_laptop",
      kind: "local",
      projects: [{ projectId: "prj_widgets", workspaces: 2 }],
    },
    {
      deviceId: "dev_desktop",
      kind: "local",
      projects: [
        { projectId: "prj_widgets", workspaces: 1 },
        { projectId: "prj_other", workspaces: 5 },
      ],
    },
    instance({}),
    instance({
      deviceId: "dev_cloud_search",
      workspace: { id: "wsp_cloud", slug: "feature-search", branch: "feature/search" },
    }),
  ] as unknown as Machine[];

  it("adds what each machine holds to the instances that are not the root", () => {
    expect(workspaceCount(machines, "prj_widgets")).toBe(4);
    expect(workspaceCount(machines, "prj_other")).toBe(5);
    expect(workspaceCount([], "prj_widgets")).toBe(0);
  });

  it("calls a project leaving only when all it has is instances on their way out", () => {
    const removing = [instance({ state: "removing", status: "destroying" })];
    expect(isLeaving(project({ locations: [cloud] }), removing)).toBe(true);
    expect(isLeaving(project({ locations: [cloud] }), [instance({})])).toBe(false);
    expect(isLeaving(project(), removing)).toBe(false);
    expect(isLeaving(project({ locations: [cloud] }), [])).toBe(false);
  });
});
