import { describe, expect, it } from "vitest";
import type { AccountClient, Project } from "./api.js";
import type { Machine } from "./api-projects.js";
import { attentionItems, olderThan } from "./attention.js";

const project = {
  id: "prj_widgets",
  name: "Widgets",
  locations: [
    { id: "loc_a", kind: "local", name: "laptop", status: "ready", error: null },
    {
      id: "loc_b",
      kind: "local",
      name: "desktop",
      status: "error",
      error: "The repository refused access. Check the credentials on desktop.",
    },
  ],
  github: { fullName: "example/widgets", private: true, lostAccess: true },
} as unknown as Project;

const failed = {
  deviceId: "dev_failed",
  kind: "cloud",
  state: "failed",
  project: { id: "prj_widgets", slug: "widgets", name: "Widgets" },
  workspace: { id: "wsp_1", slug: "fix-login", branch: "fix/login" },
  error: "The machine could not be set up.",
} as unknown as Machine;

const client = (patch: Partial<AccountClient>): AccountClient => ({
  clientId: "client_a",
  clientName: "ChatGPT",
  clientUri: null,
  mcpName: null,
  mcpVersion: null,
  authorizedAt: 1,
  lastUsedAt: null,
  allProjects: false,
  projects: [],
  ...patch,
});

describe("attentionItems", () => {
  it("says nothing when nothing is wrong", () => {
    expect(attentionItems({ projects: [], machines: [], accountClients: [] })).toEqual([]);
  });

  it("lists each problem with the page that fixes it", () => {
    const items = attentionItems({
      projects: [project],
      machines: [failed, { ...failed, deviceId: "dev_ok", state: "online" } as Machine],
      accountClients: [
        client({}),
        client({ clientId: "client_all", allProjects: true }),
        client({
          clientId: "client_some",
          projects: [{ id: "pcl_1", projectId: "prj_widgets", revokedAt: null }],
        }),
      ],
    });

    expect(items.map((item) => [item.key, item.to])).toEqual([
      ["instance:dev_failed", "/machines?view=cloud&state=failed"],
      ["location:loc_b", "/projects/prj_widgets"],
      ["github:prj_widgets", "/settings"],
      ["client:client_a", "/clients"],
    ]);
    expect(items[0]?.title).toBe("The instance for fix/login of Widgets failed.");
    expect(items[1]?.action).toContain("refused access");
  });

  it("names the root instance by its branch and the default mark", () => {
    const [item] = attentionItems({
      projects: [],
      machines: [{ ...failed, workspace: { id: null, slug: "main", branch: "master" } } as Machine],
      accountClients: [],
    });
    expect(item?.title).toBe("The instance for master · default of Widgets failed.");
  });
});

describe("machines behind the current release", () => {
  const machine = (patch: Partial<Machine>) =>
    ({
      deviceId: "dev_laptop",
      kind: "local",
      name: "Laptop",
      state: "online",
      cliVersion: "0.17.0",
      projects: [],
      ...patch,
    }) as unknown as Machine;

  it("names a machine of the person's own that is on an older release", () => {
    const items = attentionItems({
      projects: [],
      machines: [
        machine({}),
        machine({ deviceId: "dev_current", cliVersion: "0.18.0" }),
        machine({ deviceId: "dev_gone", state: "removed" }),
        machine({ deviceId: "dev_cloud", kind: "cloud" }),
      ],
      accountClients: [],
      latestCliVersion: "0.18.0",
    });

    expect(items.map((item) => item.key)).toEqual(["cli:dev_laptop"]);
    expect(items[0]?.action).toContain("exeora upgrade");
  });

  it("compares releases by their numbers, and says nothing of what it cannot read", () => {
    expect(olderThan("0.9.0", "0.10.0")).toBe(true);
    expect(olderThan("0.18.0", "0.18.0")).toBe(false);
    expect(olderThan("1.0.0", "0.18.0")).toBe(false);
    expect(olderThan("0.18.0-beta.1", "0.18.0")).toBe(false);
    expect(olderThan(null, "0.18.0")).toBe(false);
    expect(olderThan("dev", "0.18.0")).toBe(false);
  });
});
