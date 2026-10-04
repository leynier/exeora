import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import {
  callAppTool,
  changeHostContext,
  type HostScenario,
  hostLog,
  openInHost,
} from "./mcp-host.js";
import { mockWorkspaceV2, project, workspace } from "./workspace-v2-mock.js";

/**
 * Comments on selected code in the Workspace panel, against the simulated
 * MCP Apps host (not ChatGPT itself): written and kept in the panel, handed
 * to the model only by "Add to context", as one titled attachment a batch.
 */

const FULLSCREEN = { displayMode: "fullscreen", availableDisplayModes: ["inline", "fullscreen"] };

const patchOf = (file: string) =>
  [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,4 +1,4 @@",
    " keep one",
    "-old two",
    "+new two",
    " keep three",
    " keep four",
  ].join("\n");

const deletedPatch = [
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-first gone",
  "-second gone",
].join("\n");

function place(extra: Record<string, unknown> = {}) {
  return { structuredContent: { projectId: project.id, workspace: null, ...extra } };
}

async function richDiffs(page: Page) {
  await page.route("**/api/projects/*/workspace/diff*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "main.txt";
    await route.fulfill({
      json: {
        kind: "diff",
        path,
        area: url.searchParams.get("area") ?? "working",
        patch: patchOf(path),
        binary: false,
        truncated: false,
      },
    });
  });
  await page.route("**/api/projects/*/workspace/reads*", async (route) => {
    const body = route.request().postDataJSON() as { action: string; area?: string };
    if (body.action !== "diff_all") return route.fallback();
    await route.fulfill({
      json: {
        kind: "diff_all",
        area: body.area,
        patch: `${patchOf("main.txt")}\n${deletedPatch}`,
        truncated: false,
        untrackedOmitted: false,
      },
    });
  });
}

async function openPanel(page: Page, scenario: Partial<HostScenario> = {}) {
  await mockWorkspaceV2(page);
  await richDiffs(page);
  return openInHost(page, {
    context: FULLSCREEN,
    input: { project: project.id, path: "src/main.ts" },
    result: place({ path: "src/main.ts", tab: "explorer" }),
    ...scenario,
  });
}

/** Selects the first line of the open file in the editor. */
async function selectFirstLine(page: Page, panel: FrameLocator) {
  const editor = panel.locator(".cm-content");
  await expect(editor).toContainText("export const answer = 42;");
  await editor.locator(".cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
}

async function comment(panel: FrameLocator, button: string, text: string) {
  await panel.getByRole("button", { name: button }).click();
  const dialog = panel.getByRole("dialog", { name: "Comment on the selection" });
  await dialog.getByLabel("Comment").fill(text);
  await dialog.getByRole("button", { name: "Add comment" }).click();
  await expect(dialog).toBeHidden();
}

async function openReview(panel: FrameLocator) {
  await panel.getByRole("button", { name: /^Comments, \d+ waiting$/ }).click();
  return panel.getByRole("dialog", { name: "Comments" });
}

/** The comments waiting in the review, apart from the batches already attached. */
function waiting(review: ReturnType<FrameLocator["getByRole"]>) {
  return review.getByRole("region", { name: "Waiting comments" }).getByRole("listitem");
}

/** Whatever reached the model, as one string, to search for leaks. */
async function modelSaw(page: Page): Promise<string> {
  const log = await hostLog(page);
  return JSON.stringify(log.modelContexts);
}

test("comments on selected file text, and adds it only when asked", async ({ page }) => {
  const panel = await openPanel(page);
  const comment1 = panel.getByRole("button", { name: "Comment on the selection" });
  await expect(panel.locator(".cm-content")).toBeVisible();
  // Nothing selected, nothing to comment on.
  await expect(comment1).toBeDisabled();
  await selectFirstLine(page, panel);
  await expect(comment1).toBeEnabled();
  await comment(panel, "Comment on the selection", "Why 42? DRAFT-SECRET");
  await expect(panel.getByRole("button", { name: "Comments, 1 waiting" })).toBeVisible();

  // Waiting comments reach no model context, however the panel moves.
  await callAppTool(page, "exeora_workspace_navigate", { tab: "search" });
  await page.waitForTimeout(400);
  expect(await modelSaw(page)).not.toContain("DRAFT-SECRET");
  expect(
    (await hostLog(page)).modelContexts.every((write) => (write.content ?? []).length === 0),
  ).toBe(true);

  const review = await openReview(panel);
  const item = review.getByRole("listitem", { name: "Comment on src/main.ts, line 1" });
  await expect(item).toContainText("export const answer = 42;");
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByText("Exeora Workspace: 1 comment on 1 file")).toBeVisible();
  await expect(waiting(review)).toHaveCount(0);
  await expect(
    review.getByRole("region", { name: "Attached to context" }).getByRole("listitem"),
  ).toHaveCount(1);

  const last = (await hostLog(page)).modelContexts.at(-1);
  expect(last?.content).toHaveLength(1);
  const block = last?.content?.[0];
  expect(block?._meta?.["openai/title"]).toBe("Exeora Workspace: 1 comment on 1 file");
  expect(block?.text).toContain(`Project: ${project.id}`);
  expect(block?.text).toContain("Path: src/main.ts");
  expect(block?.text).toContain("Selection: file, line 1 column 1 to line 1 column 26");
  expect(block?.text).toContain("export const answer = 42;");
  expect(block?.text).toContain("Comment: Why 42? DRAFT-SECRET");
  // The selection only: not the rest of the file.
  expect(block?.text).not.toContain('console.log("hello")');
  // The workspace metadata stays places and names.
  expect(JSON.stringify(last?.structuredContent)).not.toContain("answer = 42");
  expect((await hostLog(page)).messages).toEqual([]);
});

test("comments on old and new diff lines, unified and split, in one batch with a file", async ({
  page,
}) => {
  const panel = await openPanel(page, {
    tools: {
      exeora_open_panel: [
        place({ tab: "source", diff: { path: "main.txt", area: "staged" } }),
        place({ tab: "source", diff: { path: "main.txt", area: "staged" } }),
      ],
    },
  });
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "File note");

  await callAppTool(page, "exeora_workspace_navigate", {
    diff: { path: "main.txt", area: "staged" },
  });
  const gutter = (type: string) =>
    panel.locator(`[data-column-number][data-line-type="${type}"]`).first();
  await gutter("change-deletion").click();
  await comment(panel, "Comment on the selected lines", "Old side note");

  // Side by side, the new column.
  await panel.getByRole("button", { name: "Show side by side" }).click();
  await gutter("change-addition").click();
  await comment(panel, "Comment on the selected lines", "New side note");

  const review = await openReview(panel);
  await expect(waiting(review)).toHaveCount(3);
  await expect(
    review.getByRole("listitem", { name: "Comment on main.txt, staged diff, old line 2" }),
  ).toContainText("-old two");
  await expect(
    review.getByRole("listitem", { name: "Comment on main.txt, staged diff, new line 2" }),
  ).toContainText("+new two");
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByText("Exeora Workspace: 3 comments on 2 files")).toBeVisible();

  const text = (await hostLog(page)).modelContexts.at(-1)?.content?.[0]?.text ?? "";
  expect(text).toContain("Path: src/main.ts");
  expect(text).toContain("Selection: staged diff, old side\nOld lines: 2-2");
  expect(text).toContain("Selection: staged diff, new side\nNew lines: 2-2");
  expect(text).toContain("Comment: New side note");
});

test("names each file of an aggregate diff, deleted files included", async ({ page }) => {
  const panel = await openPanel(page);
  await expect(panel.locator(".cm-content")).toBeVisible();
  // Every working change at once, as a deep link opens it.
  await changeHostContext(page, {
    "openai/deepLink": {
      url: `/workspace?project=${project.id}&view=source&detail=diffall:working`,
    },
  });
  const gone = panel.locator('section[aria-label="gone.ts"]');
  await gone.locator('[data-column-number][data-line-type="change-deletion"]').first().click();
  await comment(panel, "Comment on the selected lines", "Why delete this?");
  const review = await openReview(panel);
  await expect(
    review.getByRole("listitem", { name: "Comment on gone.ts, working tree diff, old line 1" }),
  ).toContainText("-first gone");
});

test("edits and deletes waiting comments", async ({ page }) => {
  const panel = await openPanel(page);
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "First");
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Second");
  const review = await openReview(panel);
  const items = waiting(review);
  await items.first().getByRole("button", { name: "Edit" }).click();
  await items.first().getByLabel("Edit comment").fill("First, edited");
  await items.first().getByRole("button", { name: "Save" }).click();
  await expect(items.first()).toContainText("First, edited");
  await items.nth(1).getByRole("button", { name: "Delete" }).click();
  await expect(items).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Comments, 1 waiting" })).toBeVisible();
});

test("keeps every comment, and says why, when the host refuses or cannot take them", async ({
  page,
}) => {
  const panel = await openPanel(page);
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Keep me");
  await page.evaluate(() => {
    (window as unknown as { failModelContext: boolean }).failModelContext = true;
  });
  const review = await openReview(panel);
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByRole("alert")).toContainText("The host refused the context.");
  await expect(waiting(review)).toHaveCount(1);
  expect(await modelSaw(page)).not.toContain("Keep me");

  // Retry once the host takes it.
  await page.evaluate(() => {
    (window as unknown as { failModelContext: boolean }).failModelContext = false;
  });
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(waiting(review)).toHaveCount(0);
  expect(await modelSaw(page)).toContain("Keep me");
});

test("says so on a host that takes no model context", async ({ page }) => {
  const panel = await openPanel(page, { noModelContext: true });
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Nowhere to go");
  const review = await openReview(panel);
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByRole("alert")).toContainText("cannot attach context");
  await expect(waiting(review)).toHaveCount(1);
});

test("keeps added batches through navigation, appends new ones, and respects removal", async ({
  page,
}) => {
  const panel = await openPanel(page, {
    tools: {
      exeora_open_panel: [
        place({ tab: "search" }),
        place({ tab: "explorer", path: "src/main.ts" }),
        place({ tab: "logs" }),
      ],
    },
  });
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Batch one");
  let review = await openReview(panel);
  await review.getByRole("button", { name: "Add to context" }).click();
  await review.getByRole("button", { name: "Close" }).click();

  await callAppTool(page, "exeora_workspace_navigate", { tab: "search" });
  await expect
    .poll(async () => (await hostLog(page)).modelContexts.at(-1)?.structuredContent)
    .toMatchObject({ "exeora/workspace": { tab: "search" } });
  expect((await hostLog(page)).modelContexts.at(-1)?.content).toHaveLength(1);

  await callAppTool(page, "exeora_workspace_navigate", { tab: "explorer", path: "src/main.ts" });
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Batch two");
  review = await openReview(panel);
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByText("Exeora Workspace: 1 comment on 1 file")).toHaveCount(2);
  const both = (await hostLog(page)).modelContexts.at(-1)?.content ?? [];
  expect(both.map((block) => block.text?.includes("Batch one"))).toEqual([true, false]);
  expect(both.map((block) => block.text?.includes("Batch two"))).toEqual([false, true]);
  await review.getByRole("button", { name: "Close" }).click();

  // The person clears the context in ChatGPT; navigating does not bring it back.
  await changeHostContext(page, { "openai/modelContext": null });
  await callAppTool(page, "exeora_workspace_navigate", { tab: "logs" });
  await expect
    .poll(async () => (await hostLog(page)).modelContexts.at(-1)?.structuredContent)
    .toMatchObject({ "exeora/workspace": { tab: "logs" } });
  expect((await hostLog(page)).modelContexts.at(-1)?.content).toEqual([]);
  review = await openReview(panel);
  await expect(review.getByText("Attached to context")).toHaveCount(0);
  expect((await hostLog(page)).messages).toEqual([]);
});

test("starts from the batches the host says are attached, after a remount", async ({ page }) => {
  const earlier = {
    type: "text",
    text: "Comments from before",
    _meta: { "openai/title": "Exeora Workspace: earlier comments", "exeora/batch": "b-earlier" },
  };
  const panel = await openPanel(page, {
    context: { ...FULLSCREEN, "openai/modelContext": { updateId: "u0", content: [earlier] } },
  });
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "After remount");
  const review = await openReview(panel);
  await expect(review.getByText("Exeora Workspace: earlier comments")).toBeVisible();
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(waiting(review)).toHaveCount(0);
  const content = (await hostLog(page)).modelContexts.at(-1)?.content ?? [];
  expect(content[0]).toEqual(earlier);
  expect(content[1]?.text).toContain("After remount");
});

test("keeps waiting comments in the widget's private state only, and restores them", async ({
  page,
}) => {
  const panel = await openPanel(page, {
    widgetState: { modelContent: { note: "visible" }, keep: 1 },
  });
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Private draft");
  await expect.poll(async () => (await hostLog(page)).widgetStates.length).toBeGreaterThan(0);
  const saved = (await hostLog(page)).widgetStates.at(-1) as Record<string, unknown>;
  expect(saved.modelContent).toEqual({ note: "visible" });
  expect(saved.keep).toBe(1);
  expect(JSON.stringify(saved.privateContent)).toContain("Private draft");
  expect(await modelSaw(page)).not.toContain("Private draft");

  // The same widget, rendered again with that state, finds them.
  const again = await openPanel(page, { widgetState: saved });
  const review = await openReview(again);
  await expect(waiting(review)).toContainText("Private draft");
  await expect(review.getByText("kept with this panel")).toBeVisible();
});

test("pins a comment to the working copy it was written in", async ({ page }) => {
  const panel = await openPanel(page, {
    tools: { exeora_open_panel: [place({ workspace: workspace.slug, tab: "explorer" })] },
  });
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "On the root");
  // Leaving with the comment waiting moves nothing about it.
  await callAppTool(page, "exeora_workspace_navigate", { workspace: workspace.slug });
  await expect
    .poll(
      async () =>
        (await callAppTool(page, "exeora_workspace_get_state")).structuredContent?.workspace,
    )
    .toBe(workspace.slug);
  const review = await openReview(panel);
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(waiting(review)).toHaveCount(0);
  const text = (await hostLog(page)).modelContexts.at(-1)?.content?.[0]?.text ?? "";
  expect(text).toContain("Workspace: default root\nPath: src/main.ts");
});

test("asks for an edit to be saved before adding, then adds the edited text", async ({ page }) => {
  const panel = await openPanel(page);
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Before");
  const review = await openReview(panel);
  await review.getByRole("button", { name: "Edit" }).click();
  await review.getByLabel("Edit comment").fill("After the edit");
  await expect(review.getByRole("button", { name: "Add to context" })).toBeDisabled();
  await expect(review.getByRole("button", { name: "Copy all comments" })).toBeDisabled();
  await review.getByRole("button", { name: "Save" }).click();
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(waiting(review)).toHaveCount(0);
  const text = (await hostLog(page)).modelContexts.at(-1)?.content?.[0]?.text ?? "";
  expect(text).toContain("Comment: After the edit");
  expect(text).not.toContain("Comment: Before");
});

test("keeps each panel's comments to itself", async ({ browser }) => {
  const one = await browser.newPage();
  const two = await browser.newPage();
  const first = await openPanel(one);
  const second = await openPanel(two);
  await selectFirstLine(one, first);
  await comment(first, "Comment on the selection", "Only in the first panel");
  await expect(first.getByRole("button", { name: "Comments, 1 waiting" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Comments, 0 waiting" })).toBeVisible();
  await one.close();
  await two.close();
});

test("copies the attached batches too, by hand where the frame has no clipboard", async ({
  page,
}) => {
  const panel = await openPanel(page);
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "Already attached");
  const review = await openReview(panel);
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(waiting(review)).toHaveCount(0);
  await review.getByRole("button", { name: "Copy all comments" }).click();
  // The sandboxed frame has no clipboard: no false "Copied", the text to copy instead.
  await expect(review.getByText(/^Copied/)).toHaveCount(0);
  const text = (await hostLog(page)).modelContexts.at(-1)?.content?.[0]?.text ?? "";
  await expect(review.getByLabel("Comments to copy")).toHaveValue(text);
  expect(text).toContain("Comment: Already attached");
});
