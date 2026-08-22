import { expect, type Page, test } from "@playwright/test";

const user = {
  id: "usr_admin",
  email: "admin@example.com",
  name: "Admin",
  avatarUrl: null,
  plan: "free",
  isAdmin: true,
  accountMcpUrl: "https://exeora.test/mcp",
  limits: { maxDevices: 2, maxProjects: 3, retentionDays: 90 },
  usage: { devices: 0, projects: 0, toolCallsMonth: 0 },
};

const subject = {
  id: "usr_subject",
  email: "subject@example.com",
  name: "Subject",
  avatarUrl: null,
  createdAt: Date.now(),
  devices: 1,
  devicesOnline: 1,
  projects: 1,
  clients: 0,
  toolCalls: 3,
  lastActivityAt: Date.now(),
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
      "/api/projects": [],
      "/api/clients": [],
      "/api/tool-calls": { items: [], cursor: null },
      "/api/approvals": { items: [] },
      "/api/admin/overview": {
        users: 1,
        devices: 1,
        devicesOnline: 1,
        projects: 1,
        clients: 0,
        toolCalls: 3,
        toolCalls24h: 1,
        toolCalls7d: 3,
        errorRate7d: 0,
        usageWindow: "rolling",
      },
      "/api/admin/users": [subject],
      [`/api/admin/users/${subject.id}`]: {
        ...subject,
        machineList: [
          {
            id: "dev_subject",
            name: "subject-box",
            platform: "linux",
            cliVersion: "0.9.0",
            online: true,
            lastSeenAt: Date.now(),
            revokedAt: null,
            createdAt: Date.now(),
          },
        ],
        projectList: [],
        clientList: [],
        recentCalls: [],
      },
    };
    const body = bodies[path];
    if (body !== undefined) {
      await route.fulfill({ status: 200, json: body });
      return;
    }
    await route.fulfill({ status: 404 });
  });
}

test("entering Admin swaps the rail for Overview and Users", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");

  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/admin");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  const sidebar = page.locator("#dashboard-sidebar");
  await expect(sidebar.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Users", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Machines" })).toHaveCount(0);

  await sidebar.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/admin/users");
  await page.getByRole("link", { name: "Subject" }).click();
  await expect(page).toHaveURL(`/dashboard/admin/users/${subject.id}`);
  await expect(page.getByRole("heading", { name: "Subject" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Machines" })).toBeVisible();
  await expect(page.getByText("subject-box")).toBeVisible();

  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByText("Nothing registered yet.")).toBeVisible();
  await expect(page.getByText("subject-box")).toHaveCount(0);
});
