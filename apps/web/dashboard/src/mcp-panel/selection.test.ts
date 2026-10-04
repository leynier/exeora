import { describe, expect, it } from "vitest";
import {
  dashboardDeepLink,
  dashboardUrl,
  deepLinkRoute,
  gatewayOrigin,
  readAnswer,
  selectionRoute,
} from "./selection.js";

const SELECTION = {
  projectId: "p1",
  workspace: "feat@laptop",
  path: "src/app.ts",
  settings: { defaultTab: "search", showIgnored: true, diffStyle: "split", theme: "light" },
  gatewayOrigin: "https://exeora.dev/ignored/path",
};

describe("readAnswer", () => {
  it("reads a selection and maps the gateway's settings onto the Workspace's", () => {
    expect(readAnswer(SELECTION)).toEqual({
      kind: "selection",
      selection: {
        projectId: "p1",
        workspace: "feat@laptop",
        path: "src/app.ts",
        tab: null,
        diff: null,
        search: null,
        settings: {
          defaultProject: null,
          defaultWorkspace: null,
          view: "search",
          showIgnored: true,
          diffStyle: "split",
        },
        gatewayOrigin: "https://exeora.dev",
      },
    });
  });

  it("keeps an explicit null over stale default settings, for the picker", () => {
    const answer = readAnswer({
      projectId: null,
      workspace: null,
      settings: { defaultProject: "p_gone", defaultWorkspace: "main@old", defaultTab: "files" },
    });
    expect(answer).toMatchObject({
      kind: "selection",
      selection: { projectId: null, workspace: null, path: null, settings: { view: "explorer" } },
    });
    expect(answer?.kind === "selection" && selectionRoute(answer.selection)).toBe(
      "/workspace?view=explorer",
    );
  });

  it("falls back to the default project only when an older gateway leaves the field out", () => {
    const answer = readAnswer({
      workspace: "other",
      path: "README.md",
      settings: { defaultProject: "p9", defaultWorkspace: "main@desk", defaultTab: "files" },
    });
    expect(answer).toMatchObject({
      kind: "selection",
      selection: {
        projectId: "p9",
        workspace: "main@desk",
        path: null,
        settings: { view: "explorer" },
      },
    });
  });

  it("keeps a selection with no project, for the Workspace's own picker", () => {
    const answer = readAnswer({ projectId: null, workspace: null });
    expect(answer).toMatchObject({ kind: "selection", selection: { projectId: null, path: null } });
  });

  it.each([
    ["/etc/passwd", null],
    ["../secret", null],
    ["a/../../b", null],
    ["./src\\main.rs", "src/main.rs"],
  ])("only takes relative paths inside the working copy: %s", (path, expected) => {
    const answer = readAnswer({ ...SELECTION, path });
    expect(answer?.kind === "selection" && answer.selection.path).toBe(expected ?? null);
  });

  it("asks for a resolve when the host kept the path", () => {
    expect(readAnswer({ needsResolve: true })).toEqual({ kind: "resolve" });
  });

  it("explains a known failure and words an unknown one generically", () => {
    expect(readAnswer({ error: "offline", message: "Laptop is offline." })).toEqual({
      kind: "failed",
      reason: "offline",
      message: "Laptop is offline.",
    });
    expect(readAnswer({ error: "outside" })).toMatchObject({
      reason: "outside",
      message: expect.stringContaining("not inside"),
    });
    expect(readAnswer({ error: "boom" })).toMatchObject({ reason: "error" });
  });

  it.each([null, "text", [], {}])("refuses %j", (value) => {
    expect(readAnswer(value)).toBeNull();
  });

  it("ignores an origin that is not http(s)", () => {
    const answer = readAnswer({ ...SELECTION, gatewayOrigin: "javascript:alert(1)" });
    expect(answer?.kind === "selection" && answer.selection.gatewayOrigin).toBeNull();
  });
});

describe("selectionRoute", () => {
  const settings = {
    defaultProject: null,
    defaultWorkspace: null,
    view: null,
    showIgnored: null,
    diffStyle: null,
  };

  it("opens a named file as the Explorer's detail", () => {
    const route = selectionRoute({
      projectId: "p1",
      workspace: "feat@laptop",
      path: "src/a b.ts",
      settings: { ...settings, view: "search" },
      gatewayOrigin: null,
    });
    const url = new URL(route, "https://x.invalid");
    expect(url.pathname).toBe("/workspace");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      project: "p1",
      workspace: "feat@laptop",
      view: "explorer",
      detail: "file:src/a b.ts",
    });
  });

  it("uses the default view without a file", () => {
    expect(
      selectionRoute({
        projectId: "p1",
        workspace: null,
        path: null,
        settings: { ...settings, view: "source" },
        gatewayOrigin: null,
      }),
    ).toBe("/workspace?project=p1&view=source");
  });

  it("is the bare Workspace with nothing selected", () => {
    expect(
      selectionRoute({
        projectId: null,
        workspace: null,
        path: null,
        settings,
        gatewayOrigin: null,
      }),
    ).toBe("/workspace");
  });
});

describe("deepLinkRoute", () => {
  it.each([
    [{ url: "/workspace?project=p1&view=search" }, "/workspace?project=p1&view=search"],
    [{ url: "/?project=p1" }, "/workspace?project=p1"],
    [{ url: "/" }, "/workspace"],
  ])("follows %j", (link, route) => {
    expect(deepLinkRoute(link)).toBe(route);
  });

  it.each([
    null,
    "/workspace",
    { url: "//evil.example/workspace" },
    { url: "https://evil.example/workspace" },
    { url: "/settings" },
    { url: "/workspace#x" },
  ])("ignores %j", (link) => {
    expect(deepLinkRoute(link)).toBeNull();
  });
});

describe("dashboardUrl", () => {
  it("builds an address in the dashboard", () => {
    expect(dashboardUrl("https://exeora.dev", "/workspace?project=p1")).toBe(
      "https://exeora.dev/dashboard/workspace?project=p1",
    );
  });

  it.each(["/../oauth/authorize", "/%2e%2e/oauth/authorize", "workspace"])("refuses %s", (path) => {
    expect(dashboardUrl("https://exeora.dev", path)).toBeNull();
  });
});

describe("gatewayOrigin", () => {
  it("takes the origin the tool result names first", () => {
    expect(
      gatewayOrigin({ gatewayOrigin: "https://exeora.dev" }, "https://other.example/dashboard/"),
    ).toBe("https://exeora.dev");
  });

  it("falls back to the gateway the injected <base> names", () => {
    expect(gatewayOrigin(null, "https://exeora.dev/dashboard/")).toBe("https://exeora.dev");
    expect(gatewayOrigin({ gatewayOrigin: null }, "http://localhost:8787/dashboard/")).toBe(
      "http://localhost:8787",
    );
  });

  it.each(["about:srcdoc", "blob:https://sandbox.example/1", "not a url"])(
    "has none on a page without a gateway base: %s",
    (baseURI) => {
      expect(gatewayOrigin(null, baseURI)).toBeNull();
    },
  );
});

describe("tabs, diffs and searches", () => {
  const settings = {
    defaultProject: null,
    defaultWorkspace: null,
    view: "explorer" as const,
    showIgnored: null,
    diffStyle: null,
  };

  it("reads what the gateway names and routes to it", () => {
    const answer = readAnswer({
      projectId: "p1",
      workspace: "feat@laptop",
      tab: "source",
      diff: { path: "src/a.ts", area: "staged" },
    });
    expect(answer).toMatchObject({
      selection: { tab: "source", diff: { path: "src/a.ts", area: "staged" }, search: null },
    });
    if (answer?.kind !== "selection") throw new Error("no selection");
    const url = new URL(selectionRoute(answer.selection), "https://x.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      project: "p1",
      workspace: "feat@laptop",
      view: "source",
      detail: "diff:staged:src/a.ts",
    });
  });

  it("carries a search, defaults filled in, to the Search view", () => {
    const answer = readAnswer({ projectId: "p1", search: { query: "todo", regex: true } });
    if (answer?.kind !== "selection") throw new Error("no selection");
    expect(answer.selection.search).toEqual({
      query: "todo",
      regex: true,
      caseSensitive: false,
      wholeWord: false,
      include: "",
      exclude: "",
      includeIgnored: false,
    });
    expect(selectionRoute(answer.selection)).toBe(
      "/workspace?project=p1&view=search&q=todo&regex=1",
    );
  });

  it("shows the named tab, else the default view", () => {
    const base = { projectId: "p1", workspace: null, path: null, settings, gatewayOrigin: null };
    expect(selectionRoute({ ...base, tab: "terminal" })).toBe(
      "/workspace?project=p1&view=terminal",
    );
    expect(selectionRoute(base)).toBe("/workspace?project=p1&view=explorer");
  });

  it.each([
    [{ tab: "admin" }, { tab: null }],
    [{ diff: { path: "../x", area: "working" } }, { diff: null }],
    [{ diff: { path: "a.ts", area: "weird" } }, { diff: { path: "a.ts", area: "working" } }],
    [{ search: { regex: true } }, { search: null }],
  ])("reads %j defensively", (extra, expected) => {
    expect(readAnswer({ projectId: "p1", ...extra })).toMatchObject({ selection: expected });
  });
});

describe("dashboardDeepLink", () => {
  it.each([
    [{ url: "/settings" }, "/settings"],
    [{ url: "/dashboard/projects/p1?tab=x" }, "/projects/p1?tab=x"],
    [{ url: "/dashboard" }, "/"],
    [{ url: "/" }, "/"],
  ])("follows %j", (link, route) => {
    expect(dashboardDeepLink(link)).toBe(route);
  });

  it.each([
    null,
    "/settings",
    { url: "//evil.example/" },
    { url: "https://evil.example/" },
    { url: "/a#b" },
  ])("ignores %j", (link) => {
    expect(dashboardDeepLink(link)).toBeNull();
  });
});

describe("an opening that waits for a project", () => {
  it("keeps the file, diff or search it asked for, for when one is picked", () => {
    const file = readAnswer({
      projectId: null,
      workspace: null,
      path: "src/a.ts",
      tab: "explorer",
    });
    if (file?.kind !== "selection") throw new Error("no selection");
    expect(file.selection).toMatchObject({ projectId: null, path: "src/a.ts" });
    expect(selectionRoute(file.selection)).toBe(
      "/workspace?view=explorer&detail=file%3Asrc%2Fa.ts",
    );

    const diff = readAnswer({ projectId: null, diff: { path: "b.ts", area: "staged" } });
    if (diff?.kind !== "selection") throw new Error("no selection");
    expect(selectionRoute(diff.selection)).toBe(
      "/workspace?view=source&detail=diff%3Astaged%3Ab.ts",
    );

    const search = readAnswer({ projectId: null, search: { query: "todo" } });
    if (search?.kind !== "selection") throw new Error("no selection");
    expect(selectionRoute(search.selection)).toBe("/workspace?view=search&q=todo");
  });
});
