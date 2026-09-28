import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

test("moves a file through the dialog and pushes a file over the tree", async ({ page }) => {
  const sent: { action: string; paths?: string[]; to?: string }[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    onRequest: (request) => {
      if (request.method() === "POST" && request.url().includes("/workspace/actions")) {
        sent.push(request.postDataJSON() as { action: string });
      }
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&view=explorer`);
  const files = page.getByRole("tree", { name: "Files" });
  await files.getByRole("treeitem", { name: "src" }).click();

  await files.getByRole("treeitem", { name: "main.txt" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const move = page.getByRole("dialog", { name: "Move to…" });
  await move.getByRole("button", { name: "Folder" }).click();
  await page.getByRole("option", { name: "src" }).click();
  await move.getByRole("button", { name: "Move to src/main.txt" }).click();
  await expect
    .poll(() => sent.at(-1))
    .toEqual({ action: "file_move", paths: ["main.txt"], to: "src" });

  await files.getByRole("treeitem", { name: "util.ts" }).click();
  await expect(page).toHaveURL(/detail=file%3Asrc%2Futil\.ts/);
  const screen = page.getByRole("region", { name: "src/util.ts" });
  await expect(screen.locator(".cm-content")).toContainText("twice");
  await screen.getByRole("button", { name: "Back" }).click();
  await expect(files.getByRole("treeitem", { name: "util.ts" })).toBeVisible();
});
