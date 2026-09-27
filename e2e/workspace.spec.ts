import { expect, type Request, test } from "@playwright/test";
import {
  mockApi,
  openWorkspace,
  otherProject,
  project,
  signedIn,
  workspace,
} from "./dashboard-mock.js";

test("opens workspace from the tab with custom project and workspace dropdowns", async ({
  page,
}) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Project ${project.name}` })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workspace main · default branch · Laptop" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();

  await page.getByRole("button", { name: "Workspace main · default branch · Laptop" }).click();
  await page.getByRole("option", { name: "feature/trees · Laptop" }).click();
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}`,
  );
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toBeVisible();
});

test("keeps source control and terminal bound to the selected workspace", async ({ page }) => {
  const requests: Request[] = [];
  await signedIn(page);
  await mockApi(page, { onRequest: (request) => requests.push(request) });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: project.name }).click();
  // The header opens the project, the first row under the location is its
  // root, and the workspace comes after both.
  await expect(page.getByText(workspace.slug, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open workspace" }).nth(2).click();
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}`,
  );

  await expect(page.locator("select")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Workspace feature/trees · Laptop" }),
  ).toBeVisible();
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
          url.searchParams.get("workspace") === workspace.id
        );
      }),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Terminal" }).click();
  await expect(page.getByText("Start an interactive shell in feature-trees")).toBeVisible();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Commands run directly on the machine that holds feature-trees",
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Workspace feature/trees · Laptop" }).click();
  await page.getByRole("option", { name: "main · default branch · Laptop" }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}&view=terminal`);
  await page.getByRole("button", { name: "Source Control" }).click();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toHaveCount(0);
});

test("opens a branch from its existing workspace instead of switching in place", async ({
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
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}`,
  );
  expect(switched).toEqual([]);
});

test("creates a workspace from Source Control, where the one on screen is", async ({ page }) => {
  const created: unknown[] = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() !== "POST") return;
      if (!request.url().endsWith(`/api/projects/${project.id}/workspaces`)) return;
      created.push(request.postDataJSON());
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Current branch main" }).click();
  // What was typed to find a branch is the branch the workspace is for.
  await page.getByPlaceholder("Find or create a branch").fill("fix-login");
  await page.getByRole("button", { name: "Create workspace" }).click();

  const create = page.getByRole("dialog", { name: "Add a workspace" });
  await expect(create.getByLabel("Branch", { exact: true })).toHaveValue("fix-login");
  await expect(create.getByLabel("Start from")).toHaveValue("main");
  await expect(create.getByRole("button", { name: "Where" })).toContainText("Laptop");
  await expect(create.getByText("A working copy of its own on Laptop")).toBeVisible();
  await create.getByRole("button", { name: "Add workspace" }).click();

  await expect
    .poll(() => created)
    .toEqual([{ branch: "fix-login", where: "laptop", from: "main" }]);
  // The gateway added the location to the slug, and the link follows what it
  // answered rather than what was asked for.
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&workspace=fix-login-laptop`,
  );
});

test("keeps an open terminal listed when switching workspaces", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open terminal" }).click();
  await expect(
    page.getByRole("button", { name: "E2E project / main · default branch" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Workspace main · default branch · Laptop" }).click();
  await page.getByRole("option", { name: "feature/trees · Laptop" }).click();
  await expect(
    page.getByRole("button", { name: "E2E project / main · default branch" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Source Control" }).click();
  await expect(
    page.getByRole("button", { name: "E2E project / main · default branch" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "E2E project / main · default branch" }).click();
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
  await expect(
    page.getByRole("button", { name: "E2E project / main · default branch" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/machines");
  await expect(
    page.getByRole("button", { name: "E2E project / main · default branch" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "E2E project / main · default branch" }).click();
  await expect(page).toHaveURL(/\/dashboard\/workspace\?project=/);
  await expect(page).toHaveURL(/view=terminal/);
});

test("lists terminals that outlived a reload on every dashboard page", async ({ page }) => {
  const chip = page.getByRole("button", { name: "E2E project / main · default branch" });
  await signedIn(page);
  await mockApi(page, {
    terminals: [{ sessionId: "term_live", projectId: project.id, startedAt: Date.now() }],
  });
  await page.goto("/dashboard/");
  await expect(chip).toBeVisible();
  await page.reload();
  await expect(chip).toBeVisible();
  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/machines");
  await expect(chip).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/settings");
  await expect(chip).toBeVisible();
});

test("keeps an open terminal listed when switching projects", async ({ page }) => {
  await signedIn(page);
  await mockApi(page, { projects: [project, otherProject] });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Terminal" }).click();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open terminal" }).click();
  await expect(
    page.getByRole("button", { name: "E2E project / main · default branch" }),
  ).toBeVisible();
  await page.getByRole("button", { name: `Project ${project.name}` }).click();
  await page.getByRole("option", { name: otherProject.name }).click();
  await expect(
    page.getByRole("button", { name: "E2E project / main · default branch" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "E2E project / main · default branch" }).click();
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
  }, `/dashboard/projects/${project.id}/workspace?workspace=${workspace.slug}`);
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}`,
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
  await expect(page.getByRole("option", { name: "origin/main Check out" })).toBeVisible();
  await page.getByRole("option", { name: /^experiment/ }).click();
  await expect(page.getByRole("button", { name: "Current branch experiment" })).toBeVisible();
});
