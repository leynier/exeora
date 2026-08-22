import { expect, type Page, test } from "@playwright/test";

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

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    if (!window.location.pathname.startsWith("/dashboard")) return;
    sessionStorage.setItem("exeora.access_token", "e2e-token");
    sessionStorage.setItem("exeora.expires_at", String(Date.now() + 3_600_000));
  });
}

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const bodies: Record<string, unknown> = {
      "/api/me": user,
      "/api/devices": [],
      "/api/projects": [project],
      "/api/clients": [],
      "/api/tool-calls": { items: [], cursor: null },
      "/api/approvals": { items: [] },
      [`/api/projects/${project.id}/worktrees`]: [],
    };
    const body = bodies[path];
    if (body !== undefined) {
      await route.fulfill({ status: 200, json: body });
      return;
    }
    await route.fulfill({ status: 404 });
  });
}

test("drags the expanded sidebar width and remembers it", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");

  const sidebar = page.locator("#dashboard-sidebar");
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(handle).toBeVisible();
  const before = await sidebar.boundingBox();
  expect(before?.width).toBeGreaterThan(200);

  const grip = await handle.boundingBox();
  expect(grip).toBeTruthy();
  if (!grip) return;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 40);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + 40, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThan((before?.width ?? 0) + 40);

  const resized = await sidebar.boundingBox();
  const remembered = Math.round(resized?.width ?? 0);
  await page.reload();
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0))
    .toBe(remembered);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(handle).toHaveCount(0);
});

test("marks a project detail as nested and returns to the list", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("link", { name: project.name }).click();
  await expect(page).toHaveURL(`/dashboard/projects/${project.id}`);

  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail).toContainText("Projects");
  await expect(trail).toContainText(project.name);
  await expect(page.getByText("Inside Project")).toBeVisible();

  const sidebar = page.locator("#dashboard-sidebar");
  await expect(sidebar.getByRole("link", { name: "Back to Projects" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Back to Projects" }).click();
  await expect(page).toHaveURL("/dashboard/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Inside Project")).toHaveCount(0);
});
