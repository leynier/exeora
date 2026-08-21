import { expect, type Page, type Request, test } from "@playwright/test";

const user = {
  id: "usr_e2e",
  email: "e2e@example.com",
  name: "E2E User",
  avatarUrl: null,
  plan: "free",
  isAdmin: false,
  accountMcpUrl: "https://exeora.test/mcp",
  limits: { maxDevices: 2, maxProjects: 3, retentionDays: 90 },
  usage: { devices: 0, projects: 1, toolCallsMonth: 0 },
};

const project = {
  id: "prj_e2e",
  slug: "e2e",
  name: "E2E project",
  deviceId: "dev_e2e",
  localPath: "/work/e2e",
  mcpUrl: "https://exeora.test/p/prj_e2e/mcp",
  policy: { mode: "allow_all", allow: [], deny: [], shell: true, approve: false, tools: null },
  createdAt: Date.now(),
};

const worktree = {
  id: "wtr_feature",
  projectId: project.id,
  slug: "feature-trees",
  name: "Feature trees",
  branch: "feature/trees",
  localPath: "/work/e2e/.worktrees/feature-trees",
  managed: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function gitStatus(target: "main" | "worktree") {
  const feature = target === "worktree";
  return {
    kind: "status",
    repository: true,
    head: feature ? "feature/trees" : "main",
    oid: feature ? "feature123" : "main123",
    upstream: null,
    ahead: 0,
    behind: 0,
    operation: null,
    files: [
      {
        path: feature ? "feature-tree.txt" : "main.txt",
        index: ".",
        worktree: "M",
        kind: "tracked",
        submodule: false,
      },
    ],
    branches: [
      {
        name: feature ? "feature/trees" : "main",
        shortOid: feature ? "feature" : "main123",
        upstream: null,
        remote: false,
        current: true,
      },
    ],
    remotes: [],
  };
}

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    if (!window.location.pathname.startsWith("/dashboard")) return;
    sessionStorage.setItem("exeora.access_token", "e2e-token");
    sessionStorage.setItem("exeora.expires_at", String(Date.now() + 3_600_000));
  });
}

async function mockApi(
  page: Page,
  options: { failDevices?: () => boolean; onRequest?: (request: Request) => void } = {},
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    options.onRequest?.(request);
    if (path === "/api/devices" && options.failDevices?.()) {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
      return;
    }

    const bodies: Record<string, unknown> = {
      "/api/me": user,
      "/api/devices": [],
      "/api/projects": [project],
      "/api/clients": [],
      "/api/tool-calls": { items: [], cursor: null },
      "/api/approvals": { items: [] },
      [`/api/projects/${project.id}/worktrees`]: [worktree],
    };
    const body = bodies[path];
    if (body !== undefined) {
      await route.fulfill({ status: 200, json: body });
      return;
    }

    const workspace = `/api/projects/${project.id}/workspace`;
    const target = url.searchParams.get("worktree") === worktree.id ? "worktree" : "main";
    if (path === `${workspace}/capabilities`) {
      await route.fulfill({
        status: 200,
        json: { online: true, sourceControl: true, terminal: true, worktreeRouting: true },
      });
      return;
    }
    if (path === `${workspace}/status`) {
      await route.fulfill({ status: 200, json: gitStatus(target) });
      return;
    }
    if (path === `${workspace}/diff`) {
      const file = target === "worktree" ? "feature-tree.txt" : "main.txt";
      await route.fulfill({
        status: 200,
        json: {
          kind: "diff",
          path: file,
          area: "working",
          patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new`,
          binary: false,
          truncated: false,
        },
      });
      return;
    }
    if (path === `${workspace}/actions`) {
      await route.fulfill({
        status: 200,
        json: { kind: "mutation", stdout: "", stderr: "", status: gitStatus(target) },
      });
      return;
    }

    await route.fulfill({ status: 404 });
  });
}

test("distinguishes a failed query from an empty account and retries it", async ({ page }) => {
  let failDevices = true;
  await signedIn(page);
  await mockApi(page, { failDevices: () => failDevices });
  await page.goto("/dashboard/");

  await expect(page.getByRole("alert")).toContainText("Could not load this data");
  await expect(page.getByText("Nothing is connected yet.")).toHaveCount(0);

  failDevices = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Nothing is connected yet.")).toBeVisible();
});

test("sign out clears the tab token and reaches the server logout endpoint", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.route("**/oauth/logout", (route) =>
    route.fulfill({ status: 200, body: "signed out" }),
  );
  await page.goto("/dashboard/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/oauth/logout");
  expect(await page.evaluate(() => sessionStorage.getItem("exeora.access_token"))).toBeNull();
});

test("clipboard denial is visible on the project list", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Projects" }).click();

  await page.getByRole("button", { name: "Copy URL" }).click();
  await expect(page.getByRole("alert")).toContainText("Clipboard access was refused");
  await expect(page.getByRole("button", { name: "Copy failed" })).toBeVisible();
});

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
  await expect(page.getByRole("button", { name: "Worktree main" })).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();

  await page.getByRole("button", { name: "Worktree main" }).click();
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
  await expect(page.getByText("feature/trees", { exact: true })).toBeVisible();
  const featureFile = page.getByRole("button", { name: /feature-tree\.txt/ });
  await expect(featureFile).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toHaveCount(0);

  await featureFile.hover();
  await page.getByRole("button", { name: "Stage" }).click();
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
  await page.getByRole("option", { name: /^main/ }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Source Control" }).click();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toHaveCount(0);
});

test("redirects legacy project workspace URLs onto the workspace tab", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto(`/dashboard/projects/${project.id}/workspace?worktree=${worktree.slug}`);
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toBeVisible();
});
