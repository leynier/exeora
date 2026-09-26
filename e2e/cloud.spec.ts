import { expect, type Page, type Request, test } from "@playwright/test";
import { signedIn, user } from "./dashboard-mock.js";

const cloudUser = {
  ...user,
  cloudEnabled: true,
  limits: { ...user.limits, maxCloudMachines: 2 },
  usage: { ...user.usage, cloudMachines: 2 },
};

const cloudProject = {
  projectId: "prj_cloud",
  slug: "widgets",
  name: "Widgets",
  repoUrl: "https://github.com/example/widgets.git",
  defaultBranch: "main",
  hasCredential: true,
  machines: [
    {
      deviceId: "dev_cloud_main",
      workspaceId: null,
      workspaceSlug: "main",
      branch: "main",
      status: "creating",
      step: "Installing",
      error: null,
      online: false,
      createdAt: Date.now(),
      readyAt: null,
    },
    {
      deviceId: "dev_cloud_feature",
      workspaceId: "wsp_cloud_feature",
      workspaceSlug: "feature-login",
      branch: "feature/login",
      status: "error",
      step: null,
      error: "The CLI did not connect in time.",
      online: false,
      createdAt: Date.now(),
      readyAt: null,
    },
  ],
};

async function mockApi(
  page: Page,
  options: {
    me?: typeof user;
    projects?: Array<typeof cloudProject>;
    onRequest?: (request: Request) => void;
  } = {},
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    options.onRequest?.(request);
    if (request.method() === "POST" && path === "/api/cloud/projects") {
      await route.fulfill({
        status: 202,
        json: { projectId: "prj_new", deviceId: "dev_new", status: "creating" },
      });
      return;
    }
    if (request.method() === "PUT" && path.endsWith("/credential")) {
      await route.fulfill({ status: 200, json: { ok: true, appliesTo: "new_machines" } });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/retry")) {
      await route.fulfill({ status: 202, json: { ok: true, status: "creating" } });
      return;
    }
    const bodies: Record<string, unknown> = {
      "/api/me": options.me ?? cloudUser,
      "/api/devices": [],
      "/api/projects": [],
      "/api/clients": [],
      "/api/tool-calls": { items: [], cursor: null },
      "/api/approvals": { items: [] },
      "/api/terminals": { items: [] },
      "/api/cloud/projects": { projects: options.projects ?? [cloudProject] },
    };
    const body = bodies[path];
    if (body !== undefined) {
      await route.fulfill({ status: 200, json: body });
      return;
    }
    await route.fulfill({ status: 404 });
  });
}

test("lists Cloud right after Machines and shows each machine's state", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");

  const labels = await page.locator("#dashboard-sidebar nav a").allTextContents();
  expect(labels.indexOf("Cloud")).toBe(labels.indexOf("Machines") + 1);

  await page.getByRole("link", { name: "Cloud", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/cloud");
  await expect(page.getByRole("heading", { name: "Widgets" })).toBeVisible();
  await expect(page.getByText("2 of 2 machines in use")).toBeVisible();
  await expect(page.getByText("Installing")).toBeVisible();
  await expect(page.getByText("The CLI did not connect in time.")).toBeVisible();
  await expect(page.getByText("private")).toBeVisible();
  // At the cap, so nothing new can be started until a machine goes.
  await expect(page.getByRole("button", { name: "Add repository" })).toBeDisabled();
});

test("retries a failed machine from its row", async ({ page }) => {
  const retried: string[] = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() === "POST") retried.push(new URL(request.url()).pathname);
    },
  });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Cloud", exact: true }).click();

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toContainText("Provisioning feature-login again.");
  expect(retried).toContain("/api/cloud/machines/dev_cloud_feature/retry");
});

test("replaces a repository's token without recreating it", async ({ page }) => {
  const puts: Array<{ path: string; body: unknown }> = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() === "PUT") {
        puts.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
      }
    },
  });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Cloud", exact: true }).click();

  await page.getByRole("button", { name: "Replace token" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Access token").fill("ghp_new");
  await dialog.getByRole("button", { name: "Save token" }).click();
  await expect(page.getByRole("status")).toContainText("Token saved.");
  expect(puts).toEqual([
    {
      path: `/api/cloud/projects/${cloudProject.projectId}/credential`,
      body: { token: "ghp_new" },
    },
  ]);
});

test("adds a repository by URL and posts what the dialog derived", async ({ page }) => {
  let posted: unknown = null;
  await signedIn(page);
  await mockApi(page, {
    me: { ...cloudUser, usage: { ...cloudUser.usage, cloudMachines: 0 } },
    onRequest: (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/cloud/projects")) {
        posted = request.postDataJSON();
      }
    },
  });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Cloud", exact: true }).click();

  await page.getByRole("button", { name: "Add repository" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Repository URL").fill("https://github.com/example/Gadgets.git");
  await expect(dialog.getByText("slug: gadgets")).toBeVisible();
  await dialog.getByLabel("Access token").fill("ghp_secret");
  await dialog.getByRole("button", { name: "Add repository" }).click();

  await expect(page.getByRole("status")).toContainText("Creating a machine for Gadgets.");
  expect(posted).toEqual({
    name: "Gadgets",
    slug: "gadgets",
    repoUrl: "https://github.com/example/Gadgets.git",
    defaultBranch: "main",
    token: "ghp_secret",
  });
});

test("tells an account without Cloud what it is and who can enable it", async ({ page }) => {
  await signedIn(page);
  await mockApi(page, { me: user, projects: [] });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Cloud", exact: true }).click();

  await expect(page.getByText("Exeora Cloud is not enabled for this account")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add repository" })).toHaveCount(0);
});

test("keeps the machines of an account switched off in view, removable but not addable", async ({
  page,
}) => {
  await signedIn(page);
  await mockApi(page, { me: user });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Cloud", exact: true }).click();

  await expect(page.getByText("Exeora Cloud is switched off for this account.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Widgets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add repository" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add workspace" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove", exact: true }).first()).toBeEnabled();
});
