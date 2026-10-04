import { expect, type Page, test } from "@playwright/test";
import { gitStatus, otherProject } from "./dashboard-mock.js";
import { appRequest, callAgain, callAppTool, hostLog, openInHost } from "./mcp-host.js";
import { mockWorkspaceV2, project, workspace } from "./workspace-v2-mock.js";

/**
 * The panel's own tools, as ChatGPT's model would use them, against the
 * simulated MCP Apps host (not ChatGPT itself). Every navigation is checked
 * through the private `exeora_panel_resolve_navigation`, whose answers the
 * scenario supplies in order; none opens the panel again.
 */

const FULLSCREEN = { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] };

function place(extra: Record<string, unknown> = {}) {
  return { structuredContent: { projectId: project.id, workspace: null, ...extra } };
}

async function openPanel(page: Page, answers: Record<string, unknown>[] = []) {
  await mockWorkspaceV2(page);
  return openInHost(page, {
    context: FULLSCREEN,
    input: { project: project.id, path: "src/main.ts" },
    result: place({ path: "src/main.ts", tab: "explorer" }),
    tools: { exeora_panel_resolve_navigation: answers },
  });
}

function resolverCalls(page: Page) {
  return hostLog(page).then((log) => {
    expect(log.calls.map((call) => call.name)).not.toContain("exeora_open_panel");
    return log.calls
      .filter((call) => call.name === "exeora_panel_resolve_navigation")
      .map((call) => call.arguments);
  });
}

test("lists its own tools and describes what it shows, without contents", async ({ page }) => {
  const panel = await openPanel(page);
  await expect(panel.locator(".cm-content")).toContainText("export const answer = 42;");

  const listed = (await appRequest(page, "tools/list")) as { tools: { name: string }[] };
  expect(listed.tools.map((tool) => tool.name)).toEqual([
    "exeora_workspace_get_state",
    "exeora_workspace_navigate",
  ]);
  const state = await callAppTool(page, "exeora_workspace_get_state");
  expect(state.structuredContent).toMatchObject({
    projectId: project.id,
    workspace: null,
    tab: "explorer",
    path: "src/main.ts",
    openPaths: ["src/main.ts"],
    dirtyPaths: [],
    pendingConfirmation: null,
  });
  expect(JSON.stringify(state)).not.toContain("answer = 42");
  // The model is told the same, unprompted.
  await expect
    .poll(async () => (await hostLog(page)).contexts.at(-1)?.["exeora/workspace"])
    .toMatchObject({ path: "src/main.ts" });
});

test("searches, and a later search updates the same Search view", async ({ page }) => {
  const panel = await openPanel(page, [
    place({ tab: "search", search: { query: "answer", include: "src/**" } }),
    place({ tab: "search", search: { query: "console", include: "src/**" } }),
  ]);
  await expect(panel.locator(".cm-content")).toBeVisible();

  const first = await callAppTool(page, "exeora_workspace_navigate", {
    search: { query: "answer", include: "src/**" },
  });
  expect(first.structuredContent?.status).toBe("applied");
  const box = panel.getByRole("searchbox", { name: "Search" });
  await expect(box).toHaveValue("answer");
  await expect(panel.getByText("export const answer = 42;").first()).toBeVisible();

  const second = await callAppTool(page, "exeora_workspace_navigate", {
    search: { query: "console" },
  });
  expect(second.structuredContent?.status).toBe("applied");
  await expect(box).toHaveValue("console");
  // The filter set by the first search stayed, and went to the gateway again.
  expect((await resolverCalls(page)).at(-1)).toMatchObject({
    project: project.id,
    search: { query: "console", include: "src/**" },
  });
  await expect(panel.getByRole("textbox", { name: /include/i })).toHaveValue("src/**");
});

test("opens a file's working and staged diffs on request", async ({ page }) => {
  const panel = await openPanel(page, [
    place({ tab: "source", diff: { path: "main.txt", area: "working" } }),
    place({ tab: "source", diff: { path: "main.txt", area: "staged" } }),
  ]);
  // main.txt changed in both: staged, then edited again.
  await page.route("**/api/projects/*/workspace/status*", async (route) => {
    const status = gitStatus("main");
    status.files = status.files.map((file) =>
      file.path === "main.txt" ? { ...file, index: "M", worktree: "M" } : file,
    );
    await route.fulfill({ json: { ...status, stashes: 0 } });
  });
  await expect(panel.locator(".cm-content")).toContainText("answer");

  const working = await callAppTool(page, "exeora_workspace_navigate", {
    diff: { path: "main.txt" },
  });
  expect(working.structuredContent).toMatchObject({
    status: "applied",
    state: { tab: "source", path: "main.txt", diff: { path: "main.txt", area: "working" } },
  });
  const tabs = panel.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab");
  await expect(tabs.filter({ hasText: "main.txt" })).toHaveCount(1);

  const staged = await callAppTool(page, "exeora_workspace_navigate", {
    diff: { path: "main.txt", area: "staged" },
  });
  expect(staged.structuredContent).toMatchObject({
    status: "applied",
    state: { tab: "source", diff: { path: "main.txt", area: "staged" } },
  });
  expect((await resolverCalls(page)).slice(-2)).toEqual([
    { project: project.id, workspace: "main", diff: { area: "working", path: "main.txt" } },
    { project: project.id, workspace: "main", diff: { area: "staged", path: "main.txt" } },
  ]);
  await expect(panel.getByText(/main\.txt · staged/i)).toBeVisible();
});

test("keeps unsaved edits across navigations in the same workspace", async ({ page }) => {
  const panel = await openPanel(page, [
    place({ tab: "explorer", path: "readme.md" }),
    place({ tab: "explorer", path: "src/main.ts" }),
  ]);
  const editor = panel.locator(".cm-content");
  await expect(editor).toContainText("answer");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // kept");
  await expect(panel.getByText("Unsaved changes")).toBeVisible();

  const moved = await callAppTool(page, "exeora_workspace_navigate", { path: "readme.md" });
  // Applied means shown: the answer already describes the file now in front.
  expect(moved.structuredContent).toMatchObject({
    status: "applied",
    state: { path: "readme.md", tab: "explorer" },
  });
  await expect(panel.getByText("A project for the specs.")).toBeVisible();
  const away = await callAppTool(page, "exeora_workspace_get_state");
  expect(away.structuredContent).toMatchObject({ path: "readme.md", dirtyPaths: ["src/main.ts"] });

  await callAppTool(page, "exeora_workspace_navigate", { path: "src/main.ts" });
  await expect(editor).toContainText("// kept");
  await expect(panel.getByText("Unsaved changes")).toBeVisible();
  const tabs = panel.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab");
  await expect(tabs).toHaveText(["main.ts●", "readme.md"]);
});

test("asks before leaving unsaved edits, whoever asks, until the person answers", async ({
  page,
}) => {
  const panel = await openPanel(page, [
    place({ workspace: workspace.slug, tab: "explorer" }),
    place({ workspace: workspace.slug, tab: "explorer" }),
  ]);
  const editor = panel.locator(".cm-content");
  await expect(editor).toContainText("answer");
  await editor.click();
  await page.keyboard.type("// draft ");

  const asked = await callAppTool(page, "exeora_workspace_navigate", {
    workspace: workspace.slug,
  });
  expect(asked.structuredContent).toMatchObject({
    status: "needs_confirmation",
    state: {
      pendingConfirmation: {
        projectId: project.id,
        workspace: workspace.slug,
        dirtyPaths: ["src/main.ts"],
      },
    },
  });
  const dialog = panel.getByRole("dialog", { name: "Leave unsaved edits?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  const stayed = await callAppTool(page, "exeora_workspace_get_state");
  expect(stayed.structuredContent).toMatchObject({
    workspace: null,
    pendingConfirmation: null,
    lastConfirmation: "cancelled",
  });

  // The Workspace's own picker asks the same question.
  await panel.getByRole("button", { name: "Workspace main · default branch · Laptop" }).click();
  await panel.getByRole("option", { name: "feature/trees · Laptop" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Leave and switch" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await callAppTool(page, "exeora_workspace_get_state")).structuredContent)
    .toMatchObject({ workspace: workspace.slug, lastConfirmation: "applied", dirtyPaths: [] });
});

test("reports a navigation the gateway refuses, and stays put", async ({ page }) => {
  const panel = await openPanel(page, [
    { isError: true, content: [{ type: "text", text: "That project is not granted here." }] },
  ]);
  await expect(panel.locator(".cm-content")).toContainText("answer");
  const result = await callAppTool(page, "exeora_workspace_navigate", { project: "prj_other" });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: "error",
    message: "That project is not granted here.",
    state: { projectId: project.id, path: "src/main.ts" },
  });
  await expect(panel.locator(".cm-content")).toContainText("answer");
});

test("opens on the search the opening call named", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: { project: project.id, search: { query: "answer", wholeWord: true } },
    result: place({ tab: "search", search: { query: "answer", wholeWord: true } }),
  });
  await expect(panel.getByRole("searchbox", { name: "Search" })).toHaveValue("answer");
  await expect(panel.getByText("export const answer = 42;").first()).toBeVisible();
  const state = await callAppTool(page, "exeora_workspace_get_state");
  expect(state.structuredContent).toMatchObject({
    tab: "search",
    search: { query: "answer", wholeWord: true, regex: false },
  });
});

/** Two projects and no default: an opening that names none waits for a pick. */
async function openUnplaced(page: Page, intent: Record<string, unknown>) {
  await mockWorkspaceV2(page);
  await page.route("**/api/projects", (route) => route.fulfill({ json: [project, otherProject] }));
  return openInHost(page, {
    context: FULLSCREEN,
    input: intent,
    result: { structuredContent: { projectId: null, workspace: null, ...intent } },
  });
}

test("keeps a file asked for before a project is chosen, and opens it after", async ({ page }) => {
  const panel = await openUnplaced(page, { path: "src/main.ts", tab: "explorer" });
  const picker = panel.getByRole("button", { name: /^Project/ });
  await expect(picker).toBeVisible();
  await expect(panel.locator(".cm-content")).toHaveCount(0);
  // Nothing of any project was read before one was chosen.
  const before = (await hostLog(page)).calls.map((call) => String(call.arguments.path ?? ""));
  expect(before.some((path) => path.includes("/workspace/"))).toBe(false);

  await picker.click();
  await panel.getByRole("option", { name: project.name }).click();
  await expect(panel.locator(".cm-content")).toContainText("export const answer = 42;");
  const state = await callAppTool(page, "exeora_workspace_get_state");
  expect(state.structuredContent).toMatchObject({
    projectId: project.id,
    tab: "explorer",
    path: "src/main.ts",
    openPaths: ["src/main.ts"],
  });
  expect(JSON.stringify(state)).not.toContain("answer = 42");
});

test("keeps a search asked for before a project is chosen", async ({ page }) => {
  const panel = await openUnplaced(page, { search: { query: "answer" } });
  await panel.getByRole("button", { name: /^Project/ }).click();
  await panel.getByRole("option", { name: project.name }).click();
  await expect(panel.getByRole("searchbox", { name: "Search" })).toHaveValue("answer");
  await expect(panel.getByText("export const answer = 42;").first()).toBeVisible();
  expect((await callAppTool(page, "exeora_workspace_get_state")).structuredContent).toMatchObject({
    projectId: project.id,
    tab: "search",
    search: { query: "answer" },
  });
});

test("takes the gateway's main for the root on screen, unsaved edits and all", async ({ page }) => {
  const panel = await openPanel(page, [
    place({ workspace: "main", tab: "explorer", path: "readme.md" }),
    place({ workspace: "main@laptop", tab: "search", search: { query: "answer" } }),
  ]);
  const editor = panel.locator(".cm-content");
  await expect(editor).toContainText("answer");
  await editor.click();
  await page.keyboard.type("// draft ");
  const dialog = panel.getByRole("dialog", { name: "Leave unsaved edits?" });

  const file = await callAppTool(page, "exeora_workspace_navigate", { path: "readme.md" });
  expect(file.structuredContent).toMatchObject({
    status: "applied",
    state: { workspace: null, tab: "explorer", path: "readme.md", dirtyPaths: ["src/main.ts"] },
  });
  const search = await callAppTool(page, "exeora_workspace_navigate", {
    search: { query: "answer" },
  });
  expect(search.structuredContent).toMatchObject({
    status: "applied",
    state: { workspace: null, tab: "search", search: { query: "answer" } },
  });
  await expect(panel.getByRole("searchbox", { name: "Search" })).toHaveValue("answer");

  // A later host result naming main lands on the same root too.
  await callAgain(page, { path: "src/main.ts" }, place({ workspace: "main", path: "src/main.ts" }));
  await expect(editor).toContainText("// draft");
  await expect(dialog).toHaveCount(0);
  expect((await callAppTool(page, "exeora_workspace_get_state")).structuredContent).toMatchObject({
    workspace: null,
    tab: "explorer",
    path: "src/main.ts",
    pendingConfirmation: null,
  });
});

test("still asks before the root of another location", async ({ page }) => {
  await mockWorkspaceV2(page);
  const desktop = {
    ...project.locations[0],
    id: "loc_desktop",
    deviceId: "dev_desktop",
    name: "Desktop",
    slug: "desktop",
    localPath: "/srv/e2e",
    default: false,
  };
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: [{ ...project, locations: [...project.locations, desktop] }] }),
  );
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: { project: project.id, path: "src/main.ts" },
    result: place({ path: "src/main.ts", tab: "explorer" }),
    tools: {
      exeora_panel_resolve_navigation: [place({ workspace: "main@desktop", tab: "explorer" })],
    },
  });
  const editor = panel.locator(".cm-content");
  await expect(editor).toContainText("answer");
  await editor.click();
  await page.keyboard.type("// draft ");

  const result = await callAppTool(page, "exeora_workspace_navigate", {
    workspace: "main@desktop",
  });
  expect(result.structuredContent).toMatchObject({
    status: "needs_confirmation",
    state: { pendingConfirmation: { workspace: "main@desktop", dirtyPaths: ["src/main.ts"] } },
  });
  const dialog = panel.getByRole("dialog", { name: "Leave unsaved edits?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toContainText("// draft");
});
