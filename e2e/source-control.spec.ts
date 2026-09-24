import { expect, test } from "@playwright/test";
import { mockApi, openWorkspace, project, signedIn, workspace } from "./dashboard-mock.js";

test("checks out a remote branch by opening its existing local branch", async ({ page }) => {
  const actions: string[] = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() !== "POST" || !request.url().includes("/workspace/actions")) return;
      actions.push((request.postDataJSON() as { action: string }).action);
    },
  });
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}`,
  );
  await page.getByRole("button", { name: "Current branch feature/trees" }).click();
  // `main` already exists locally, and is checked out at the project root.
  // Tracking origin/main again would fail with "a branch named main exists".
  await page.getByRole("option", { name: "origin/main Checkout" }).click();

  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await expect(page.getByRole("button", { name: "Current branch main" })).toBeVisible();
  expect(actions).not.toContain("branch_track");
});

test("closing a terminal chip ends the session on the machine as well", async ({ page }) => {
  const closed: string[] = [];
  await signedIn(page);
  await mockApi(page, {
    terminals: [{ sessionId: "term_live", projectId: project.id, startedAt: Date.now() }],
    onRequest: (request) => {
      if (request.method() === "DELETE" && request.url().includes("/terminal")) {
        closed.push(new URL(request.url()).pathname);
      }
    },
  });
  await page.goto("/dashboard/");
  await page.getByRole("button", { name: "Close terminal project root" }).click();

  await expect.poll(() => closed).toEqual([`/api/projects/${project.id}/terminal`]);
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toHaveCount(0);
});
