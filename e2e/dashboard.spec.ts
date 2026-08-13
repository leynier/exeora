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

async function mockApi(page: Page, options: { failDevices?: () => boolean } = {}) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
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
    };
    const body = bodies[path];
    await route.fulfill(body === undefined ? { status: 404 } : { status: 200, json: body });
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
