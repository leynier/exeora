import { expect, type Page, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

/**
 * Unsaved edits kept across tab switches keep the version they started
 * from: a file that changed on the machine meanwhile is a conflict every time
 * the edit comes back, and only an explicit overwrite writes over it.
 */

const ORIGINAL = 'export const answer = 42;\nconsole.log("hello");\n';
const CHANGED = 'export const answer = 43;\nconsole.log("changed on the machine");\n';

/** main.ts at version v1 until `change()`, then v2; writes are checked against it. */
async function machineFile(page: Page) {
  let version = 1;
  let content = ORIGINAL;
  const writes: { content?: string; expectedToken?: string }[] = [];
  await page.route("**/api/projects/*/workspace/reads*", async (route) => {
    const body = route.request().postDataJSON() as { action: string; path?: string };
    if (body.action !== "file_read" || body.path !== "src/main.ts") return route.fallback();
    await route.fulfill({
      json: {
        kind: "file",
        path: "src/main.ts",
        content,
        encoding: "text",
        token: `v${version}`,
        size: content.length,
        truncated: false,
        binary: false,
        mime: null,
      },
    });
  });
  await page.route("**/api/projects/*/workspace/actions*", async (route) => {
    const body = route.request().postDataJSON() as {
      action: string;
      content?: string;
      expectedToken?: string;
    };
    if (body.action !== "file_write") return route.fallback();
    writes.push({ content: body.content, expectedToken: body.expectedToken });
    const stale = body.expectedToken !== undefined && body.expectedToken !== `v${version}`;
    if (!stale) {
      version += 1;
      content = body.content ?? "";
    }
    await route.fulfill({
      json: {
        kind: "file_write",
        path: "src/main.ts",
        status: stale ? "conflict" : "written",
        token: `v${version}`,
      },
    });
  });
  return {
    writes,
    change: () => {
      version = 2;
      content = CHANGED;
    },
  };
}

/**
 * A change made from here (a new file) re-reads the checkout, the file whose
 * edit is waiting in another tab included: that is how v2 reaches the page.
 */
async function touchCheckout(page: Page) {
  await page.getByRole("button", { name: "New file" }).click();
  const create = page.getByRole("dialog", { name: "New file" });
  await create.getByLabel("Name").fill("touched.txt");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(create).toBeHidden();
}

test("keeps an edit's base version through remounts, so a changed file stays a conflict", async ({
  page,
}) => {
  await signedIn(page);
  await mockWorkspaceV2(page);
  const machine = await machineFile(page);
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&view=explorer&detail=file:src/main.ts`,
  );
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("answer = 42");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// mine");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  // Edited from v1; the machine moves the file to v2.
  machine.change();
  const tabs = page.getByRole("tablist", { name: "Open files and diffs" });
  const files = page.getByRole("tree", { name: "Files" });
  const banner = page.getByText(
    "The file changed on the machine. Reload it, or overwrite it with what is here.",
    { exact: true },
  );
  for (let round = 0; round < 3; round += 1) {
    await files.getByRole("treeitem", { name: "readme.md" }).click();
    await expect(page.getByText("A project for the specs.")).toBeVisible();
    if (round === 0) await touchCheckout(page);
    await tabs.getByRole("tab", { name: /main\.ts/ }).click();
    await expect(editor).toContainText("// mine");
    await expect(banner).toBeVisible();
  }

  // A plain save, by shortcut or button, does not get past it.
  await editor.click();
  await page.keyboard.press("Control+s");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(banner).toBeVisible();
  expect(machine.writes).toEqual([]);

  // Overwrite says what it does, and does it.
  await page.getByRole("button", { name: "Overwrite" }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(machine.writes).toHaveLength(1);
  expect(machine.writes[0]?.expectedToken).toBeUndefined();
  expect(machine.writes[0]?.content).toContain("// mine");

  // Settled: coming back finds no conflict, and the next edit saves against v3.
  await files.getByRole("treeitem", { name: "readme.md" }).click();
  await tabs.getByRole("tab", { name: /main\.ts/ }).click();
  await expect(banner).toBeHidden();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" again");
  await page.keyboard.press("Control+s");
  await expect.poll(() => machine.writes.length).toBe(2);
  expect(machine.writes[1]?.expectedToken).toBe("v3");
  await expect(banner).toBeHidden();
});

test("reload takes the machine's version and drops the edit", async ({ page }) => {
  await signedIn(page);
  await mockWorkspaceV2(page);
  const machine = await machineFile(page);
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&view=explorer&detail=file:src/main.ts`,
  );
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("answer = 42");
  await editor.click();
  await page.keyboard.type("// mine ");
  machine.change();
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: "readme.md" })
    .click();
  await touchCheckout(page);
  await page
    .getByRole("tablist", { name: "Open files and diffs" })
    .getByRole("tab", { name: /main\.ts/ })
    .click();
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(editor).toContainText("changed on the machine");
  await expect(editor).not.toContainText("// mine");
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  expect(machine.writes).toEqual([]);
});

test("discarding a conflicted edit returns to the machine's version for good", async ({ page }) => {
  await signedIn(page);
  await mockWorkspaceV2(page);
  const machine = await machineFile(page);
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&view=explorer&detail=file:src/main.ts`,
  );
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("answer = 42");
  await editor.click();
  await page.keyboard.type("// mine ");
  machine.change();
  const files = page.getByRole("tree", { name: "Files" });
  const tab = page
    .getByRole("tablist", { name: "Open files and diffs" })
    .getByRole("tab", { name: /main\.ts/ });
  const banner = page.getByText(
    "The file changed on the machine. Reload it, or overwrite it with what is here.",
    { exact: true },
  );
  await files.getByRole("treeitem", { name: "readme.md" }).click();
  await touchCheckout(page);
  await tab.click();
  await expect(banner).toBeVisible();

  await page.getByRole("button", { name: "Discard edits" }).click();
  await expect(banner).toBeHidden();
  await expect(editor).toContainText("changed on the machine");
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  // Nothing is kept to come back: the next visit is the plain file.
  await files.getByRole("treeitem", { name: "readme.md" }).click();
  await tab.click();
  await expect(banner).toBeHidden();
  await expect(editor).not.toContainText("// mine");
  expect(machine.writes).toEqual([]);
});
