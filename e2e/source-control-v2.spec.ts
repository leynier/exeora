import { expect, type Request, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

test("shows the history with its graph, and opens a commit's files and diffs", async ({ page }) => {
  await signedIn(page);
  await mockWorkspaceV2(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  const list = page.getByRole("complementary", { name: "Source Control" });

  await list.getByRole("button", { name: "Show commits" }).click();
  const commits = list.getByRole("region", { name: "Commits" });
  await expect(commits.getByText("Merge branch 'feature/trees'")).toBeVisible();
  await expect(commits.getByText("main", { exact: true })).toBeVisible();
  await expect(commits.getByText("v0.1")).toBeVisible();
  await expect(commits.getByRole("list").locator("svg")).toHaveCount(4);

  await commits.getByRole("button", { name: /Grow a tree/ }).click();
  const tabs = page.getByRole("tablist", { name: "Open files and diffs" });
  await expect(tabs.getByRole("tab")).toHaveText(["f1f1f1f"]);
  await expect(page.getByText("Because trees.")).toBeVisible();
  await page.getByRole("button", { name: /docs\/tree\.md/ }).click();
  await expect(tabs.getByRole("tab")).toHaveText(["f1f1f1f", "tree.md"]);
  await expect(page.getByText("In f1f1f1f")).toBeVisible();

  await tabs.getByRole("tab", { name: "f1f1f1f" }).click();
  await page.getByRole("button", { name: "Open all changes" }).click();
  await expect(page.getByText("All changes in the commit")).toBeVisible();
});

test("keeps the rest of git under the chevron, with stashes in reach", async ({ page }) => {
  const sent: string[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    onRequest: (request: Request) => {
      if (request.method() === "POST" && request.url().includes("/workspace/actions")) {
        sent.push((request.postDataJSON() as { action: string }).action);
      }
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  const list = page.getByRole("complementary", { name: "Source Control" });

  await expect(list.getByRole("button", { name: "Stage changes" })).toBeVisible();
  await list.getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("menu", { name: "More actions" });
  await expect(menu.getByRole("menuitem", { name: "Commit", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Amend last commit" })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "Stash pop" }).click();
  await expect.poll(() => sent).toContain("stash_pop");

  await expect(list.getByText("WIP on main: try the thing")).toBeVisible();
  await list.getByRole("button", { name: "Drop this stash", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Drop this stash?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Drop stash" }).click();
  await expect.poll(() => sent).toContain("stash_drop");

  await list.getByRole("button", { name: "Open every change as one diff" }).click();
  await expect(
    page.getByRole("tablist", { name: "Open files and diffs" }).getByRole("tab"),
  ).toHaveText(["All changes"]);
});
