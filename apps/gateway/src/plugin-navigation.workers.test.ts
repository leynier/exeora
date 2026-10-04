import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db/client.js";
import { PluginAccess } from "./plugin-access.js";
import { PROJECT, pluginEnv, props, setupPluginFixture } from "./plugin-extensions-fixtures.js";
import { navigationSelection, type PanelNavigationInput } from "./plugin-navigation.js";

beforeEach(setupPluginFixture);

describe("Workspace navigation selections", () => {
  const access = () => new PluginAccess(pluginEnv, props);

  it("opens every tab and preserves connection defaults", async () => {
    for (const tab of ["explorer", "search", "source", "pr", "terminal", "logs"] as const)
      expect(await access().selection({ tab })).toMatchObject({
        projectId: PROJECT,
        workspace: "main",
        tab,
      });
    expect(navigationSelection({})).toEqual({});
  });

  it("infers a file, diff and search tab and fills their defaults", async () => {
    expect(await access().selection({ path: "src/app.ts" })).toMatchObject({
      tab: "explorer",
      path: "src/app.ts",
    });
    expect(await access().selection({ diff: { path: "src/app.ts" } })).toMatchObject({
      tab: "source",
      diff: { path: "src/app.ts", area: "working" },
    });
    expect(
      await access().selection({ diff: { path: "src/app.ts", area: "staged" } }),
    ).toMatchObject({ diff: { area: "staged" } });
    expect(
      await access().selection({ search: { query: "TODO", include: "src/**", regex: true } }),
    ).toMatchObject({
      tab: "search",
      search: {
        query: "TODO",
        include: "src/**",
        exclude: "",
        regex: true,
        wholeWord: false,
        caseSensitive: false,
        includeIgnored: false,
      },
    });
    expect(navigationSelection({ search: { query: "" } })).toMatchObject({
      tab: "search",
      search: { query: "" },
    });
  });

  it("rejects contradictions, traversal and unknown options before selecting a project", () => {
    for (const args of [
      { path: "app.ts", search: { query: "x" } },
      { diff: { path: "app.ts" }, search: { query: "x" } },
      { path: "app.ts", tab: "terminal" },
      { diff: { path: "app.ts" }, tab: "explorer" },
      { diff: { path: "../secret" } },
      { path: "/etc/passwd" },
      { tab: "unknown" },
      { search: { query: "x", replacement: "y" } },
      { search: { query: "x".repeat(1001) } },
    ])
      expect(() => navigationSelection(args as PanelNavigationInput)).toThrow();
  });

  it("keeps the requested content through a project picker", async () => {
    await db(env)
      .delete(schema.projectClients)
      .where(eq(schema.projectClients.id, "pcl_plugin_extensions"));
    expect(await access().selection({ search: { query: "TODO" } })).toMatchObject({
      projectId: null,
      workspace: null,
      tab: "search",
      search: { query: "TODO" },
    });
    await expect(access().selection({ diff: { path: "../secret" } })).rejects.toThrow();
  });

  it("does not turn navigation into access to a revoked project", async () => {
    await db(env)
      .update(schema.projectClients)
      .set({ revokedAt: new Date() })
      .where(eq(schema.projectClients.id, "pcl_plugin_extensions"));
    await expect(
      access().selection({ project: PROJECT, diff: { path: "app.ts" } }),
    ).rejects.toThrow();
    await expect(
      access().selection({ project: PROJECT, search: { query: "secret" } }),
    ).rejects.toThrow();
  });
});
