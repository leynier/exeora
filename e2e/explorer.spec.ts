import { expect, type Request, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

type Sent = { action: string; path?: string; from?: string; to?: string; expectedToken?: string };

function collect(sent: Sent[]) {
  return (request: Request) => {
    if (request.method() === "POST" && request.url().includes("/workspace/actions")) {
      sent.push(request.postDataJSON() as Sent);
    }
  };
}

test("lists folders a level at a time and opens a file in the editor", async ({ page }) => {
  const reads: string[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    onRequest: (request) => {
      if (request.url().includes("/workspace/reads")) {
        const body = request.postDataJSON() as { action: string; path?: string };
        reads.push(`${body.action}:${body.path ?? ""}`);
      }
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&view=explorer`);
  const files = page.getByRole("tree", { name: "Files" });
  await expect(files.getByRole("treeitem")).toHaveText([/^src$/, /^main\.txtM$/, /^readme\.md$/]);
  await expect(files.getByRole("treeitem", { name: "main.txt" })).toContainText("M");
  expect(reads).not.toContain("tree:src");

  await files.getByRole("treeitem", { name: "src" }).click();
  await expect(files.getByRole("treeitem", { name: "main.ts" })).toBeVisible();
  expect(reads).toContain("tree:src");

  await page.getByRole("button", { name: "Show ignored files" }).click();
  await expect(files.getByRole("treeitem", { name: "node_modules" })).toBeVisible();

  await files.getByRole("treeitem", { name: "main.ts" }).click();
  const tabs = page.getByRole("tablist", { name: "Open files and diffs" });
  await expect(tabs.getByRole("tab")).toHaveText(["main.ts"]);
  await expect(page.locator(".cm-content")).toContainText("export const answer = 42;");
});

test("saves with the version it read, and says when the file moved on", async ({ page }) => {
  const sent: Sent[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, { onRequest: collect(sent) });
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&view=explorer&detail=file:src/main.ts`,
  );
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("answer");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // edited");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => sent.at(-1)?.action).toBe("file_write");
  expect(sent.at(-1)).toMatchObject({ path: "src/main.ts", expectedToken: "tok1" });
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);

  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" CONFLICT");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("The file changed on the machine.")).toBeVisible();
  await page.getByRole("button", { name: "Overwrite" }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent.at(-1)?.expectedToken).toBeUndefined();
  await expect(page.getByText("The file changed on the machine.")).toHaveCount(0);
});

test("renames from the row's menu and creates from the toolbar", async ({ page }) => {
  const sent: Sent[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, { onRequest: collect(sent) });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&view=explorer`);
  const files = page.getByRole("tree", { name: "Files" });

  await files.getByRole("treeitem", { name: "readme.md" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await expect(rename.getByLabel("Name")).toHaveValue("readme.md");
  await rename.getByLabel("Name").fill("README.md");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect
    .poll(() => sent.at(-1))
    .toEqual({ action: "file_rename", from: "readme.md", to: "README.md" });

  await page.getByRole("button", { name: "New file" }).click();
  const create = page.getByRole("dialog", { name: "New file" });
  await create.getByLabel("Name").fill("notes/todo.txt");
  await expect(create.getByText("A name cannot contain a slash.")).toBeVisible();
  await create.getByLabel("Name").fill("todo.txt");
  await create.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ action: "file_create", path: "todo.txt" });
  await expect(
    page.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab"),
  ).toHaveText(["todo.txt"]);
});
