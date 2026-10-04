import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { appRequest, callAppTool, hostLog, openInHost, releaseHeld } from "./mcp-host.js";
import { relayGateway } from "./panel-relay.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

/**
 * The model moving an open Workspace panel through the gateway's public
 * tools, carried to the panel over the relay: a simulated host that never
 * lists or calls the panel's own tools, and a stand-in for the gateway's
 * relay socket. Every later navigation is checked by the private resolver;
 * nothing opens the panel again.
 */

const FULLSCREEN = { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] };
const PANEL = "7d0f2c8e-4a51-4b8e-9b0e-1f2a3b4c5d6e";
const RESOLVER = "exeora_panel_resolve_navigation";

function place(extra: Record<string, unknown> = {}) {
  return { structuredContent: { projectId: project.id, workspace: null, ...extra } };
}

async function openRelayed(page: Page, answers: Record<string, unknown>[] = []) {
  const gateway = await relayGateway(page);
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: FULLSCREEN,
    input: { project: project.id, path: "src/main.ts" },
    result: place({ path: "src/main.ts", tab: "explorer", panelId: PANEL }),
    tools: { [RESOLVER]: answers },
    relay: { panelId: PANEL },
  });
  await expect(panel.locator(".cm-content")).toContainText("export const answer = 42;");
  return { panel, gateway };
}

const control = (panel: FrameLocator) =>
  panel.getByRole("region", { name: "ChatGPT control" }).getByRole("status");

const toolNames = async (page: Page) => (await hostLog(page)).calls.map((call) => call.name);

test("the model reads and moves the open panel over the relay, on a host that never lists app tools", async ({
  page,
}) => {
  const { panel, gateway } = await openRelayed(page, [
    place({ tab: "explorer", path: "readme.md", panelId: PANEL }),
    place({ tab: "search", search: { query: "answer" }, panelId: PANEL }),
  ]);
  const socket = await gateway.connect(0, PANEL);
  await expect(control(panel)).toHaveText("ChatGPT can move this panel");
  expect(socket.received[0]).toEqual({ type: "ready", protocol: 1 });
  // The model is told the panel's address, beside where it is.
  await expect
    .poll(async () => (await hostLog(page)).contexts.at(-1)?.["exeora/workspace"])
    .toMatchObject({ panelId: PANEL, relay: "connected", path: "src/main.ts" });

  const state = await gateway.call(socket, PANEL, "get_state");
  expect(state).toEqual({
    state: expect.objectContaining({ path: "src/main.ts", tab: "explorer" }),
  });
  expect(JSON.stringify(state)).not.toContain("answer = 42");

  const file = await gateway.call(socket, PANEL, "navigate", { path: "readme.md" });
  expect(file).toMatchObject({ status: "applied", state: { path: "readme.md" } });
  await expect(panel.getByText("A project for the specs.")).toBeVisible();

  const search = await gateway.call(socket, PANEL, "navigate", { search: { query: "answer" } });
  expect(search).toMatchObject({ status: "applied", state: { tab: "search" } });
  await expect(panel.getByRole("searchbox", { name: "Search" })).toHaveValue("answer");
  // The same tabs, moved in place: the file opened by the first move is still there.
  await expect(
    panel.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab"),
  ).toHaveText(["main.ts", "readme.md"]);

  const log = await hostLog(page);
  expect(log.appRequests).toEqual([]);
  expect(await toolNames(page)).not.toContain("exeora_open_panel");
  expect(log.calls.filter((call) => call.name === RESOLVER).map((call) => call.arguments)).toEqual([
    { panelId: PANEL, project: project.id, workspace: "main", path: "readme.md" },
    {
      panelId: PANEL,
      project: project.id,
      workspace: "main",
      search: expect.objectContaining({ query: "answer", include: "", regex: false }),
    },
  ]);
  expect(log.calls.find((call) => call.name === "exeora_panel_relay_ticket")?.arguments).toEqual({
    panelId: PANEL,
    origin: "null",
    surface: "workspace",
  });
});

test("refuses commands it cannot carry out, and ignores those meant for another panel", async ({
  page,
}) => {
  const { gateway } = await openRelayed(page);
  const socket = await gateway.connect(0, PANEL);
  const outside = await gateway.call(socket, PANEL, "navigate", { path: "../etc/passwd" });
  expect(outside).toMatchObject({ status: "error", message: expect.stringContaining("relative") });
  const unknown = await gateway.call(socket, PANEL, "type_text", {});
  expect(unknown).toMatchObject({ status: "error", message: "Unknown operation." });

  const elsewhere = gateway.send(socket, "0b8f1e2d-3c4b-4a59-8687-a1b2c3d4e5f6", "get_state");
  const stale = gateway.send(
    socket,
    PANEL,
    "get_state",
    {},
    {
      generation: "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a",
    },
  );
  await page.waitForTimeout(300);
  expect(gateway.replies(socket, elsewhere)).toEqual([]);
  expect(gateway.replies(socket, stale)).toEqual([]);
  expect(await toolNames(page)).not.toContain(RESOLVER);
});

test("Stop ends ChatGPT's control until the person resumes it", async ({ page }) => {
  const { panel, gateway } = await openRelayed(page, [
    place({ tab: "explorer", path: "readme.md", panelId: PANEL }),
  ]);
  const first = await gateway.connect(0, PANEL);
  await expect(control(panel)).toHaveText("ChatGPT can move this panel");

  await panel.getByRole("button", { name: "Stop" }).click();
  await expect(control(panel)).toHaveText("ChatGPT control stopped");
  await expect.poll(() => first.closed).not.toBeNull();
  await expect
    .poll(async () => (await hostLog(page)).contexts.at(-1)?.["exeora/workspace"])
    .toMatchObject({ panelId: PANEL, relay: "stopped" });
  // The panel's own tool is refused too, and nothing moved.
  const refused = await callAppTool(page, "exeora_workspace_navigate", { path: "readme.md" });
  expect(refused).toMatchObject({ isError: true, structuredContent: { status: "error" } });
  expect(await toolNames(page)).not.toContain(RESOLVER);
  await page.waitForTimeout(1_500);
  expect(gateway.sockets).toHaveLength(1);

  await panel.getByRole("button", { name: "Resume" }).click();
  const second = await gateway.connect(1, PANEL);
  expect(second.url).not.toBe(first.url);
  await expect(control(panel)).toHaveText("ChatGPT can move this panel");
  const moved = await gateway.call(second, PANEL, "navigate", { path: "readme.md" });
  expect(moved).toMatchObject({ status: "applied" });
});

test("reconnects with a fresh ticket after a drop, taking nothing from the old connection", async ({
  page,
}) => {
  const { panel, gateway } = await openRelayed(page);
  const first = await gateway.connect(0, PANEL);
  await first.route.close({ code: 1011, reason: "restarting" });
  await expect(control(panel)).toHaveText(/Reconnecting|ChatGPT can move/);
  const second = await gateway.connect(1, PANEL);
  expect(second.url).toContain("ticket=2");
  await expect(control(panel)).toHaveText("ChatGPT can move this panel");
  // A command for the old generation, on the new socket, is not taken.
  const old = gateway.send(second, PANEL, "get_state", {}, { generation: first.generation });
  const state = await gateway.call(second, PANEL, "get_state");
  expect(state).toMatchObject({ state: { path: "src/main.ts" } });
  expect(gateway.replies(second, old)).toEqual([]);
});

test("stops reconnecting once the gateway hands the panel to a newer connection", async ({
  page,
}) => {
  const { panel, gateway } = await openRelayed(page);
  const first = await gateway.connect(0, PANEL);
  await first.route.close({ code: 1000, reason: "Replaced by this instance new connection" });
  await expect(control(panel)).toHaveText(
    "ChatGPT control moved to a newer connection of this panel.",
  );
  await page.waitForTimeout(1_500);
  expect(gateway.sockets).toHaveLength(1);
  await expect(panel.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("keeps comment batches attached while the relay moves the panel", async ({ page }) => {
  const { panel, gateway } = await openRelayed(page, [
    place({ tab: "explorer", path: "readme.md", panelId: PANEL }),
  ]);
  const socket = await gateway.connect(0, PANEL);
  const editor = panel.locator(".cm-content");
  await editor.locator(".cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await panel.getByRole("button", { name: "Comment on the selection" }).click();
  const composer = panel.getByRole("dialog", { name: "Comment on the selection" });
  await composer.getByLabel("Comment").fill("Keep me attached");
  await composer.getByRole("button", { name: "Add comment" }).click();
  await panel.getByRole("button", { name: /^Comments, 1 waiting$/ }).click();
  const review = panel.getByRole("dialog", { name: "Comments" });
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByText("Exeora Workspace: 1 comment on 1 file")).toBeVisible();
  await review.getByRole("button", { name: "Close" }).click();

  const moved = await gateway.call(socket, PANEL, "navigate", { path: "readme.md" });
  expect(moved).toMatchObject({ status: "applied" });
  await expect
    .poll(async () => (await hostLog(page)).modelContexts.at(-1)?.structuredContent)
    .toMatchObject({ "exeora/workspace": { panelId: PANEL, path: "readme.md" } });
  const last = (await hostLog(page)).modelContexts.at(-1);
  expect(last?.content).toHaveLength(1);
  expect(last?.content?.[0]?.text).toContain("Comment: Keep me attached");
});

test("closes for good when the host tears the panel down, even with its frame still there", async ({
  page,
}) => {
  const { panel, gateway } = await openRelayed(page, [
    { ...place({ tab: "explorer", path: "readme.md", panelId: PANEL }), held: true },
  ]);
  const socket = await gateway.connect(0, PANEL);
  // A comment batch attached before the teardown.
  await panel.locator(".cm-content .cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await panel.getByRole("button", { name: "Comment on the selection" }).click();
  const composer = panel.getByRole("dialog", { name: "Comment on the selection" });
  await composer.getByLabel("Comment").fill("Still attached");
  await composer.getByRole("button", { name: "Add comment" }).click();
  await panel.getByRole("button", { name: /^Comments, 1 waiting$/ }).click();
  const review = panel.getByRole("dialog", { name: "Comments" });
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByText("Exeora Workspace: 1 comment on 1 file")).toBeVisible();
  await review.getByRole("button", { name: "Close" }).click();

  // The model's move is still being checked when the host tears the view down.
  const inFlight = gateway.send(socket, PANEL, "navigate", { path: "readme.md" });
  await expect.poll(async () => (await toolNames(page)).includes(RESOLVER)).toBe(true);
  await appRequest(page, "ui/resource-teardown", {});
  await expect.poll(() => socket.closed).not.toBeNull();
  await expect(control(panel)).toHaveText("ChatGPT closed this panel");
  await expect(panel.getByRole("button", { name: /^(Stop|Resume|Try again)$/ })).toHaveCount(0);

  await releaseHeld(page);
  await page.waitForTimeout(1_500);
  expect(gateway.replies(socket, inFlight)).toEqual([]);
  await expect(panel.getByText("A project for the specs.")).toHaveCount(0);
  expect(gateway.sockets).toHaveLength(1);
  expect(
    (await toolNames(page)).filter((name) => name === "exeora_panel_relay_ticket"),
  ).toHaveLength(1);
  const native = await callAppTool(page, "exeora_workspace_navigate", { path: "readme.md" });
  expect(native).toMatchObject({ isError: true, structuredContent: { status: "error" } });

  // The model is told nothing more of where the panel is; the comments stay.
  const last = (await hostLog(page)).modelContexts.at(-1);
  expect(last?.structuredContent).toEqual({});
  expect(last?.content).toHaveLength(1);
  expect(last?.content?.[0]?.text).toContain("Comment: Still attached");
});
