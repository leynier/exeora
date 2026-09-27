import { expect, test } from "@playwright/test";
import { mockApi, signedIn } from "./dashboard-mock.js";

test("distinguishes a failed query from an empty account and retries it", async ({ page }) => {
  let failMachines = true;
  await signedIn(page);
  await mockApi(page, { projects: [], failMachines: () => failMachines });
  await page.goto("/dashboard/");

  await expect(page.getByRole("alert")).toContainText("Could not load this data");
  await expect(page.getByRole("heading", { name: "Use my machine" })).toHaveCount(0);

  failMachines = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Use my machine" })).toBeVisible();
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

test("uses a collapsible sidebar and a full-width content pane", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");

  const sidebar = page.locator("#dashboard-sidebar");
  const main = page.locator("main");
  const expanded = await sidebar.boundingBox();
  const content = await main.boundingBox();
  expect(expanded?.width).toBeGreaterThan(200);
  expect(content?.width).toBeGreaterThan(900);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(80);

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL("/dashboard/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test.describe("mobile dashboard", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the sidebar drawer and closes it with Escape", async ({ page }) => {
    await signedIn(page);
    await mockApi(page);
    await page.goto("/dashboard/");

    const toggle = page.locator("#dashboard-menu-toggle");
    await expect(toggle).toBeVisible();
    await expect(page.getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "Projects", exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expect(page.getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
  });
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
  await page.getByRole("link", { name: "Projects", exact: true }).click();

  // The URL is reference material on the list, so it sits behind a disclosure.
  await page.getByText("Connect a client").click();
  await page.getByRole("button", { name: "Copy URL" }).click();
  await expect(page.getByRole("alert")).toContainText("Clipboard access was refused");
  await expect(page.getByRole("button", { name: "Copy failed" })).toBeVisible();
});

test("lists the destinations in order, with no entry for Cloud", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await expect(page.locator("#dashboard-sidebar nav a")).toHaveText([
    "Overview",
    "Projects",
    "Workspace",
    "Machines",
    "Clients",
    "Activity",
    "Settings",
  ]);
});

test("shows both ways to start to an account with no project", async ({ page }) => {
  await signedIn(page);
  await mockApi(page, { projects: [] });
  await page.goto("/dashboard/");

  await expect(page.getByRole("heading", { name: "Use my machine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Use Exeora Cloud" })).toBeVisible();
  await expect(page.getByText("exeora connect", { exact: true })).toBeVisible();
  await expect(page.getByText("exeora project add .", { exact: true })).toBeVisible();
  // This account has no Cloud, and the path says who gives it rather than
  // offering a button that would be refused.
  await expect(
    page.getByText("Exeora Cloud is not enabled for this account. An administrator enables it."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(0);
});
