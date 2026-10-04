import { expect, test } from "@playwright/test";
import { callAgain, hostLog, openInHost } from "./mcp-host.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

const FULLSCREEN = { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] };
const FILE = { name: "main.ts", resourceUri: "host-resource://main" };
const GATEWAY = "https://exeora.dev";

test("opens from an entrypoint on the result the host hands over", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: {},
    result: {
      structuredContent: {
        projectId: project.id,
        workspace: null,
        settings: { defaultTab: "files", showIgnored: false, diffStyle: "unified" },
        gatewayOrigin: GATEWAY,
      },
    },
  });

  const files = panel.getByRole("tree", { name: "Files" });
  await expect(files.getByRole("treeitem", { name: "readme.md" })).toBeVisible();
  const { calls } = await hostLog(page);
  expect(calls.map((call) => call.name)).not.toContain("exeora_open_panel");
  expect(calls).toContainEqual({
    name: "exeora_panel_request",
    arguments: { method: "GET", path: "/api/projects" },
  });

  await panel.getByRole("button", { name: "Dashboard" }).click();
  await expect
    .poll(async () => (await hostLog(page)).links)
    .toEqual([`${GATEWAY}/dashboard/workspace?project=${project.id}&view=explorer`]);
});

test("resolves a file from a thread and opens it in the editor", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: { file: FILE },
    result: { structuredContent: { needsResolve: true, file: FILE } },
    tools: {
      exeora_resolve_file: [
        { structuredContent: { projectId: project.id, workspace: null, path: "src/main.ts" } },
      ],
    },
  });

  await expect(panel.locator(".cm-content")).toContainText("export const answer = 42;");
  await expect(
    panel.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab"),
  ).toHaveText(["main.ts"]);
  // The file opens in the Explorer of the project it was resolved to.
  await expect(panel.getByRole("tree", { name: "Files" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /E2E project/ })).toBeVisible();
  const { calls } = await hostLog(page);
  expect(calls).toContainEqual({ name: "exeora_resolve_file", arguments: { file: FILE } });
});

test("explains a file it cannot place, and retries", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: { file: FILE },
    result: { structuredContent: { needsResolve: true, file: FILE } },
    tools: {
      exeora_resolve_file: [
        {
          isError: true,
          content: [{ type: "text", text: "This file is not inside any Exeora project." }],
        },
        { structuredContent: { projectId: project.id, workspace: null, path: "readme.md" } },
      ],
    },
  });

  await expect(panel.getByText("Could not open main.ts")).toBeVisible();
  await expect(panel.getByText("This file is not inside any Exeora project.")).toBeVisible();
  await panel.getByRole("button", { name: "Try again" }).click();
  // A Markdown file opens on its rendered preview.
  await expect(panel.getByText("A project for the specs.")).toBeVisible();
});

test("asks for fullscreen on its own when the model opens it inline", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: { ...FULLSCREEN, displayMode: "inline" },
    input: { project: project.id, path: "src/main.ts" },
    result: {
      structuredContent: { projectId: project.id, workspace: null, path: "src/main.ts" },
    },
  });

  await expect(panel.locator(".cm-content")).toContainText("export const answer = 42;");
  expect((await hostLog(page)).modes).toEqual(["fullscreen"]);
});

test("stays a card when the host keeps it inline, and asks again on request", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: { ...FULLSCREEN, displayMode: "inline" },
    declineFullscreen: true,
    input: { project: project.id, path: "src/main.ts" },
    result: {
      structuredContent: { projectId: project.id, workspace: null, path: "src/main.ts" },
    },
  });

  await expect(panel.getByText("src/main.ts")).toBeVisible();
  await expect.poll(async () => (await hostLog(page)).modes).toEqual(["fullscreen"]);
  await panel.getByRole("button", { name: "Open workspace" }).click();
  await expect.poll(async () => (await hostLog(page)).modes).toEqual(["fullscreen", "fullscreen"]);
  await expect(panel.locator(".cm-content")).toHaveCount(0);
});

test("follows a later call in the same thread without reloading", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: { file: FILE },
    result: { structuredContent: { projectId: project.id, workspace: null, path: "src/main.ts" } },
  });
  const tabs = panel.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab");
  await expect(tabs).toHaveText(["main.ts"]);

  await callAgain(
    page,
    { project: project.id, path: "readme.md" },
    { structuredContent: { projectId: project.id, workspace: null, path: "readme.md" } },
  );
  await expect(tabs).toHaveText(["main.ts", "readme.md"]);
  await expect(panel.getByText("A project for the specs.")).toBeVisible();
  // The second opening used the result it was handed; nothing asked again.
  const names = (await hostLog(page)).calls.map((call) => call.name);
  const asked = names.filter(
    (name) => name !== "exeora_panel_request" && name !== "exeora_panel_relay_ticket",
  );
  expect(asked).toEqual([]);
});

test("resolves a file clicked later in the same thread, not the earlier result", async ({
  page,
}) => {
  await mockWorkspaceV2(page);
  const readme = { name: "readme.md", resourceUri: "host-resource://readme" };
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: { file: FILE },
    result: { structuredContent: { projectId: project.id, workspace: null, path: "src/main.ts" } },
    tools: {
      exeora_resolve_file: [
        { structuredContent: { projectId: project.id, workspace: null, path: "readme.md" } },
      ],
    },
  });
  const tabs = panel.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab");
  await expect(tabs).toHaveText(["main.ts"]);

  await callAgain(
    page,
    { file: readme },
    { structuredContent: { needsResolve: true, file: readme } },
  );
  await expect(tabs).toHaveText(["main.ts", "readme.md"]);
  await expect(panel.getByText("A project for the specs.")).toBeVisible();
  const resolves = (await hostLog(page)).calls.filter(
    (call) => call.name === "exeora_resolve_file",
  );
  expect(resolves).toEqual([{ name: "exeora_resolve_file", arguments: { file: readme } }]);
});

test("asks for fullscreen again for a later call while kept inline", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: { ...FULLSCREEN, displayMode: "inline" },
    declineFullscreen: true,
    input: { project: project.id, path: "src/main.ts" },
    result: {
      structuredContent: { projectId: project.id, workspace: null, path: "src/main.ts" },
    },
  });
  await expect(panel.getByText("src/main.ts")).toBeVisible();
  await expect.poll(async () => (await hostLog(page)).modes).toEqual(["fullscreen"]);

  await callAgain(
    page,
    { project: project.id, path: "readme.md" },
    { structuredContent: { projectId: project.id, workspace: null, path: "readme.md" } },
  );
  await expect(panel.getByText("readme.md")).toBeVisible();
  await expect.poll(async () => (await hostLog(page)).modes).toEqual(["fullscreen", "fullscreen"]);
});

test("says files open on desktop when the host hands none over", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    fileAccess: false,
    input: { file: FILE },
    result: { structuredContent: { needsResolve: true, file: FILE } },
    tools: {
      exeora_resolve_file: [
        { isError: true, content: [{ type: "text", text: "No file path from the host." }] },
      ],
    },
  });

  await expect(panel.getByText(/works in the ChatGPT desktop app/)).toBeVisible();
  await panel.getByRole("button", { name: "Choose a workspace" }).click();
  await expect(panel.getByRole("heading", { name: "Workspace" })).toBeVisible();
});

test("sends pull requests to the dashboard", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: {},
    result: {
      structuredContent: {
        projectId: project.id,
        workspace: null,
        settings: { defaultTab: "source-control" },
        gatewayOrigin: GATEWAY,
      },
    },
  });

  await panel.getByRole("button", { name: "Pull Request" }).first().click();
  await expect(panel.getByText("Pull requests open in the dashboard")).toBeVisible();
  await panel.getByRole("button", { name: "Open in dashboard" }).click();
  await expect
    .poll(async () => (await hostLog(page)).links)
    .toEqual([`${GATEWAY}/dashboard/workspace?project=${project.id}&view=pr`]);
  const paths = (await hostLog(page)).calls.map((call) => String(call.arguments.path ?? ""));
  expect(paths.some((path) => path.includes("pull-request"))).toBe(false);
});

test("reaches every view through routes the gateway allows", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: {},
    result: { structuredContent: { projectId: project.id, workspace: null } },
  });
  for (const view of ["Explorer", "Search", "Source Control", "Terminal", "Logs"]) {
    await panel.getByRole("button", { name: view }).first().click();
  }
  await expect(panel.getByRole("button", { name: "Logs" }).first()).toBeVisible();
  // Logs, the last view, asks for its ticket; by then the earlier views'
  // requests have gone out, and the allowlist below has seen them all.
  await expect
    .poll(async () => {
      const paths = (await hostLog(page)).calls.map((call) => String(call.arguments.path ?? ""));
      return paths.some((path) => path.split("?")[0]?.endsWith("/logs-ticket"));
    })
    .toBe(true);
});

// Whatever a test did, nothing the panel asked for was refused by the
// gateway's allowlist: the views needing more say so instead of asking.
test.afterEach(async ({ page }) => {
  expect((await hostLog(page)).refused).toEqual([]);
});
