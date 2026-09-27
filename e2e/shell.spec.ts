import { expect, test } from "@playwright/test";
import { mockApi, project, signedIn } from "./dashboard-mock.js";

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
  await page.getByRole("link", { name: "Projects", exact: true }).click();
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
