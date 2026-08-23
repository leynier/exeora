import { expect, test } from "@playwright/test";
import { mockApi, signedIn } from "./dashboard-mock.js";

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

  await page.getByRole("link", { name: "Projects" }).click();
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
    await expect(page.getByRole("link", { name: "Projects" })).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expect(page.getByRole("link", { name: "Projects" })).toHaveCount(0);
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
  await page.getByRole("link", { name: "Projects" }).click();

  await page.getByRole("button", { name: "Copy URL" }).click();
  await expect(page.getByRole("alert")).toContainText("Clipboard access was refused");
  await expect(page.getByRole("button", { name: "Copy failed" })).toBeVisible();
});

test("places Workspace after Activity in the shell nav", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  const labels = await page.locator("#dashboard-sidebar nav a").allTextContents();
  expect(labels.indexOf("Activity")).toBeGreaterThan(-1);
  expect(labels.indexOf("Workspace")).toBeGreaterThan(labels.indexOf("Activity"));
});
