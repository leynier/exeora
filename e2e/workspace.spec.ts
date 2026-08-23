import { expect, type Request, test } from "@playwright/test";
import {
  mockApi,
  openWorkspace,
  otherProject,
  project,
  signedIn,
  worktree,
} from "./dashboard-mock.js";

test("opens workspace from the tab with custom project and worktree dropdowns", async ({
  page,
}) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Project ${project.name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Worktree project root" })).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();

  await page.getByRole("button", { name: "Worktree project root" }).click();
  await page.getByRole("option", { name: /feature-trees/ }).click();
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toBeVisible();
});

test("keeps source control and terminal bound to the selected worktree", async ({ page }) => {
  const requests: Request[] = [];
  await signedIn(page);
  await mockApi(page, { onRequest: (request) => requests.push(request) });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("link", { name: project.name }).click();
  await expect(page.getByText(worktree.name, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open workspace" }).nth(1).click();
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );

  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Worktree ${worktree.slug}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Current branch feature/trees" })).toBeVisible();
  const featureFile = page.getByRole("button", { name: /feature-tree\.txt/ });
  await expect(featureFile).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toHaveCount(0);

  await featureFile.hover();
  await page.getByRole("button", { name: "Stage", exact: true }).click();
  await expect
    .poll(() =>
      requests.some((request) => {
        const url = new URL(request.url());
        return (
          request.method() === "POST" &&
          url.pathname.endsWith("/workspace/actions") &&
          url.searchParams.get("worktree") === worktree.id
        );
      }),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Terminal" }).click();
  await expect(page.getByText("Start an interactive shell in feature-trees")).toBeVisible();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Commands run directly on your connected machine in feature-trees",
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: `Worktree ${worktree.slug}` }).click();
  await page.getByRole("option", { name: /project root/ }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}&view=terminal`);
  await page.getByRole("button", { name: "Source Control" }).click();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toHaveCount(0);
});

test("opens a branch from its existing worktree instead of switching in place", async ({
  page,
}) => {
  const switched: string[] = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() !== "POST" || !request.url().includes("/workspace/actions")) return;
      const body = request.postDataJSON() as { action?: string };
      if (body.action === "branch_switch") switched.push(body.action);
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Current branch main" }).click();
  await page.getByRole("option", { name: /feature\/trees/ }).click();
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );
  expect(switched).toEqual([]);
});

test("creates a worktree from Source Control", async ({ page }) => {
  const created: string[] = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() !== "POST" || !request.url().includes("/workspace/actions")) return;
      const body = request.postDataJSON() as { action?: string; branch?: string };
      if (body.action === "worktree_create") created.push(body.branch ?? "");
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Current branch main" }).click();
  await page.getByRole("button", { name: "Create worktree" }).click();
  const create = page.getByRole("dialog", { name: "Create a Git worktree?" });
  await expect(create).toBeVisible();
  await create.getByRole("textbox").fill("from-source-control");
  await create.getByRole("button", { name: "Create worktree" }).click();
  await expect.poll(() => created).toEqual(["from-source-control"]);
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=from-source-control`,
  );
});

test("keeps an open terminal listed when switching worktrees", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toBeVisible();
  await page.getByRole("button", { name: "Worktree project root" }).click();
  await page.getByRole("option", { name: /feature-trees/ }).click();
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toBeVisible();
  await page.getByRole("button", { name: "Source Control" }).click();
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toBeVisible();
  await page.getByRole("button", { name: "E2E project / project root" }).click();
  await expect(page.getByRole("button", { name: "Terminal", exact: true })).toHaveClass(
    /border-brand/,
  );
});

test("keeps an open terminal listed on other dashboard pages", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toBeVisible();
  await page.getByRole("link", { name: "Machines" }).click();
  await expect(page).toHaveURL("/dashboard/machines");
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toBeVisible();
  await page.getByRole("button", { name: "E2E project / project root" }).click();
  await expect(page).toHaveURL(/\/dashboard\/workspace\?project=/);
  await expect(page).toHaveURL(/view=terminal/);
});

test("keeps an open terminal listed when switching projects", async ({ page }) => {
  await signedIn(page);
  await mockApi(page, { projects: [project, otherProject] });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toBeVisible();
  await page.getByRole("button", { name: `Project ${project.name}` }).click();
  await page.getByRole("option", { name: otherProject.name }).click();
  await expect(page.getByRole("button", { name: "E2E project / project root" })).toBeVisible();
  await page.getByRole("button", { name: "E2E project / project root" }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}&view=terminal`);
});

test("redirects legacy project workspace URLs onto the workspace tab", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await expect(page.getByRole("link", { name: "Workspace", exact: true })).toBeVisible();
  await page.evaluate((href) => {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `/dashboard/projects/${project.id}/workspace?worktree=${worktree.slug}`);
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toBeVisible();
});

test("stage all moves working-tree files into staged", async ({ page }) => {
  const staged: string[][] = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() !== "POST" || !request.url().includes("/workspace/actions")) return;
      const body = request.postDataJSON() as { action?: string; paths?: string[] };
      if (body.action === "stage") staged.push(body.paths ?? []);
    },
  });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\.md/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /changes/i })).toContainText("2");

  await page.getByRole("button", { name: "Stage all" }).click();
  await expect.poll(() => staged.at(-1)?.slice().sort()).toEqual(["main.txt", "notes.md"].sort());
  await expect(page.getByRole("heading", { name: /staged/i })).toContainText("2");
  await expect(page.getByRole("heading", { name: /changes/i })).toContainText("0");
  await expect(page.getByRole("button", { name: "Unstage all" })).toBeVisible();
});

test("switches branches from the toolbar picker", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: "Current branch main" }).click();
  await expect(page.getByPlaceholder("Find or create a branch")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current" })).toBeVisible();
  await expect(page.getByRole("option", { name: /feature\/trees/ })).toBeVisible();
  await expect(page.getByRole("option", { name: "origin/main Checkout" })).toBeVisible();
  await page.getByRole("option", { name: /^experiment/ }).click();
  await expect(page.getByRole("button", { name: "Current branch experiment" })).toBeVisible();
});
