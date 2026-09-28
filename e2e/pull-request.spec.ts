import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project, pullRequest, workspace } from "./workspace-v2-mock.js";

test("shows the branch's pull request with its checks and conversation, and merges it", async ({
  page,
}) => {
  const posts: string[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    github: { pullRequest },
    onRequest: (request) => {
      if (request.method() !== "GET" && request.url().includes("/pull-request")) {
        posts.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    },
  });
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}&view=pr`,
  );
  const panel = page.getByRole("complementary", { name: "Pull Request" });
  await expect(panel.getByText("#42", { exact: true })).toBeVisible();
  await expect(panel.getByText("Grow a tree")).toBeVisible();
  await expect(panel.getByText("feature/trees → main")).toBeVisible();
  await expect(panel.getByRole("button", { name: /1 failing check/ })).toBeVisible();
  await expect(panel.getByRole("link", { name: /lint/ })).toHaveAttribute(
    "href",
    "https://github.com/example/e2e/runs/1",
  );
  await expect(panel.getByText("Looks")).toBeVisible();
  await expect(panel.getByText("approved")).toBeVisible();

  await panel.getByRole("textbox", { name: "New comment" }).fill("Ship it");
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect
    .poll(() => posts)
    .toContain(`POST /api/projects/${project.id}/pull-request/42/comments`);

  await panel.getByRole("button", { name: "Squash and merge" }).click();
  const confirm = page.getByRole("dialog", { name: "Squash and merge #42?" });
  await confirm.getByRole("button", { name: "Squash and merge" }).click();
  await expect
    .poll(() => posts)
    .toContain(`POST /api/projects/${project.id}/pull-request/42/merge`);
});

test("offers to open a pull request for a branch without one, pushing first", async ({ page }) => {
  let created: { title: string; base: string; head: string; draft: boolean } | null = null;
  await signedIn(page);
  await mockWorkspaceV2(page, {
    github: { pullRequest: null },
    ai: true,
    onRequest: (request) => {
      if (request.method() === "POST" && /\/pull-request$/.test(new URL(request.url()).pathname)) {
        created = request.postDataJSON() as typeof created;
      }
    },
  });
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}&view=pr`,
  );
  const panel = page.getByRole("complementary", { name: "Pull Request" });
  await expect(panel.getByText("No pull request for")).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Title" })).toHaveValue("feature/trees");

  await panel.getByRole("button", { name: "Write the title and description" }).click();
  await expect(panel.getByRole("textbox", { name: "Title" })).toHaveValue("Grow a tree");
  await expect(panel.getByRole("textbox", { name: "Description" })).toHaveValue("Trees are good.");

  await panel.getByRole("button", { name: "Create pull request" }).click();
  await expect
    .poll(() => created)
    .toEqual({
      title: "Grow a tree",
      body: "Trees are good.",
      base: "main",
      head: "feature/trees",
      draft: false,
    });
});

test("says what stands in the way when GitHub is not connected", async ({ page }) => {
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&view=pr`);
  await expect(page.getByText("Connect GitHub first")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect it in Settings" })).toHaveAttribute(
    "href",
    "/dashboard/settings",
  );
});
