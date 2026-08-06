import { describe, expect, it } from "vitest";
import type { ProjectView } from "./api.js";
import type { ProjectEntry } from "./config.js";
import { reconcile } from "./sync.js";

/**
 * The mirror `sync` keeps between the gateway and the local config.
 *
 * Deleting from the dashboard is the side nobody sees from here: the row
 * disappears in D1 while the config file keeps listing the project, and
 * `project list` happily serves the ghost. These cover the reconciliation
 * for each way the two sides drift apart.
 */

const remote = (over: Partial<ProjectView> = {}): ProjectView => ({
  id: "prj_1",
  slug: "api",
  name: "api",
  deviceId: "dev_1",
  localPath: "/home/someone/work/api",
  mcpUrl: "https://exeora.dev/p/prj_1/mcp",
  createdAt: 0,
  ...over,
});

const local = (over: Partial<ProjectEntry> = {}): ProjectEntry => ({
  id: "prj_1",
  slug: "api",
  name: "api",
  root: "/home/someone/work/api",
  ...over,
});

describe("reconciling local projects with the gateway", () => {
  it("leaves a matching list untouched", () => {
    const result = reconcile([local()], [remote()], "dev_1");
    expect(result.next).toEqual([local()]);
    expect(result.removed).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  it("drops projects deleted from the dashboard", () => {
    // The ghost this command exists for: gone in D1, still in the config.
    const result = reconcile([local()], [], "dev_1");
    expect(result.next).toEqual([]);
    expect(result.removed).toEqual([local()]);
  });

  it("drops projects the record repointed at another machine", () => {
    // A `connect --reset` elsewhere re-homes the id; serving it from here
    // would route calls to a machine that no longer has the directory.
    const result = reconcile([local()], [remote({ deviceId: "dev_elsewhere" })], "dev_1");
    expect(result.next).toEqual([]);
    expect(result.removed).toEqual([local()]);
  });

  it("pulls in projects this machine serves that the config missed", () => {
    const result = reconcile([], [remote()], "dev_1");
    expect(result.next).toEqual([local()]);
    expect(result.added).toEqual([local()]);
  });

  it("lets the gateway's record win when the two sides drift", () => {
    const result = reconcile([local({ slug: "old-api", name: "old" })], [remote()], "dev_1");
    expect(result.next).toEqual([local()]);
    expect(result.updated).toEqual([local()]);
    expect(result.removed).toEqual([]);
  });

  it("does not pull in projects other machines serve", () => {
    const result = reconcile([], [remote({ deviceId: "dev_elsewhere" })], "dev_1");
    expect(result.next).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it("reconciles each project on its own merits", () => {
    const staying = local();
    const ghost = local({ id: "prj_2", slug: "web", root: "/home/someone/work/web" });
    const missed = remote({ id: "prj_3", slug: "docs", localPath: "/home/someone/work/docs" });

    const result = reconcile([staying, ghost], [remote(), missed], "dev_1");
    expect(result.next).toEqual([
      staying,
      { id: "prj_3", slug: "docs", name: "api", root: "/home/someone/work/docs" },
    ]);
    expect(result.removed).toEqual([ghost]);
    expect(result.added).toHaveLength(1);
  });
});
