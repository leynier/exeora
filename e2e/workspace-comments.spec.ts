import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { openInChromeShell } from "./chrome-shell.js";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project, workspace } from "./workspace-v2-mock.js";

/**
 * Comments in the Workspace outside ChatGPT: the dashboard in its own tab,
 * and the Chrome side panel. Every Workspace comments and copies; only
 * ChatGPT's panel adds to a model's context, so neither of these shows it.
 */

type Root = Page | FrameLocator;

async function selectFirstLine(page: Page, root: Root) {
  const editor = root.locator(".cm-content");
  await expect(editor).toContainText("export const answer = 42;");
  await editor.locator(".cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
}

async function comment(root: Root, button: string, text: string) {
  await root.getByRole("button", { name: button }).click();
  const dialog = root.getByRole("dialog", { name: "Comment on the selection" });
  await dialog.getByLabel("Comment").fill(text);
  await dialog.getByRole("button", { name: "Add comment" }).click();
  await expect(dialog).toBeHidden();
}

async function openReview(root: Root) {
  await root.getByRole("button", { name: /^Comments, \d+ waiting$/ }).click();
  return root.getByRole("dialog", { name: "Comments" });
}

const waiting = (review: ReturnType<Root["getByRole"]>) =>
  review.getByRole("region", { name: "Waiting comments" }).getByRole("listitem");

async function dashboardFile(page: Page) {
  await signedIn(page);
  await mockWorkspaceV2(page);
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&view=explorer&detail=file:src/main.ts`,
  );
}

test("comments on a file and a diff in the dashboard, and copies them all", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await dashboardFile(page);
  await selectFirstLine(page, page);
  await comment(page, "Comment on the selection", "File note");

  // A change in Source Control, its lines.
  await page.getByRole("button", { name: "Source Control" }).first().click();
  await page
    .getByRole("button", { name: /main\.txt/ })
    .first()
    .click();
  await page.locator('[data-column-number][data-line-type="change-addition"]').first().click();
  await comment(page, "Comment on the selected lines", "Diff note");

  const review = await openReview(page);
  await expect(waiting(review)).toHaveCount(2);
  await expect(review.getByRole("button", { name: "Add to context" })).toHaveCount(0);
  await review.getByRole("button", { name: "Copy all comments" }).click();
  await expect(review.getByRole("status")).toHaveText("Copied 2 comments.");

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(
    "Comment 1\nProject: prj_e2e\nWorkspace: default root\nPath: src/main.ts\nSelection: file, line 1 column 1 to line 1 column 26",
  );
  expect(copied).toContain("Path: main.txt\nSelection: working diff, new side\nNew lines: 1-1");
  expect(copied).toContain("Comment: Diff note");
  // Copying sends nothing anywhere and keeps them waiting.
  await expect(waiting(review)).toHaveCount(2);
});

test("falls back to text to select when the clipboard refuses, and claims no copy", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await dashboardFile(page);
  await selectFirstLine(page, page);
  await comment(page, "Comment on the selection", "Copy me by hand");
  const review = await openReview(page);
  await review.getByRole("button", { name: "Copy all comments" }).click();
  await expect(review.getByRole("alert")).toContainText("cannot use the clipboard");
  await expect(review.getByLabel("Comments to copy")).toHaveValue(/Comment: Copy me by hand/);
  await expect(review.getByText(/^Copied/)).toHaveCount(0);
  await expect(waiting(review)).toHaveCount(1);
});

test("keeps a comment, pinned where it was written, across workspaces and views", async ({
  page,
}) => {
  await dashboardFile(page);
  await selectFirstLine(page, page);
  await comment(page, "Comment on the selection", "On the root");
  await page.getByRole("button", { name: "Workspace main · default branch · Laptop" }).click();
  await page.getByRole("option", { name: "feature/trees · Laptop" }).click();
  await expect(page).toHaveURL(new RegExp(`workspace=${workspace.slug}`));
  await page.getByRole("button", { name: "Search" }).first().click();
  await expect(page.getByRole("button", { name: "Comments, 1 waiting" })).toBeVisible();
  const review = await openReview(page);
  await expect(
    review.getByRole("listitem", { name: "Comment on src/main.ts, line 1" }),
  ).toBeVisible();
});

test("asks for an edit to be saved before copying, and refuses an overlong comment intact", async ({
  page,
}) => {
  await dashboardFile(page);
  await selectFirstLine(page, page);
  // Too long: refused, and the text stays as typed.
  await page.getByRole("button", { name: "Comment on the selection" }).click();
  const composer = page.getByRole("dialog", { name: "Comment on the selection" });
  const long = "x".repeat(4_050);
  await composer.getByLabel("Comment").fill(long);
  await composer.getByRole("button", { name: "Add comment" }).click();
  await expect(composer.getByRole("alert")).toContainText("at most 4,000 characters");
  await expect(composer.getByLabel("Comment")).toHaveValue(long);
  await composer.getByLabel("Comment").fill("Short");
  await composer.getByRole("button", { name: "Add comment" }).click();

  const review = await openReview(page);
  await review.getByRole("button", { name: "Edit" }).click();
  await review.getByLabel("Edit comment").fill("Short, edited");
  await expect(review.getByRole("button", { name: "Copy all comments" })).toBeDisabled();
  await review.getByRole("button", { name: "Save" }).click();
  await expect(review.getByRole("button", { name: "Copy all comments" })).toBeEnabled();
  await expect(waiting(review)).toContainText("Short, edited");
});

test("comments and copies in the Chrome side panel, without Add to context", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signedIn(page);
  await mockWorkspaceV2(page);
  const panel = await openInChromeShell(page);
  await panel.getByRole("button", { name: "Explorer" }).first().click();
  const files = panel.getByRole("tree", { name: "Files" });
  await files.getByRole("treeitem", { name: "src" }).click();
  await files.getByRole("treeitem", { name: "main.ts" }).click();
  await selectFirstLine(page, panel);
  await comment(panel, "Comment on the selection", "From the side panel");
  const review = await openReview(panel);
  await expect(review.getByRole("button", { name: "Add to context" })).toHaveCount(0);
  await review.getByRole("button", { name: "Copy all comments" }).click();
  await expect(review.getByRole("status")).toHaveText("Copied 1 comment.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Path: src/main.ts");
  expect(copied).toContain("Comment: From the side panel");
});
