import { expect, test } from "@playwright/test";

test("lists every page in the sidebar, grouped, with the current one marked", async ({ page }) => {
  await page.goto("/docs/clients/");
  const sidebar = page.getByRole("navigation", { name: "Documentation" }).last();

  await expect(sidebar.getByText("Get started", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Chrome extension" })).toHaveAttribute(
    "href",
    "/docs/extension/",
  );
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText("Connecting a client");
});

test("outlines the page from its own headings", async ({ page }) => {
  await page.goto("/docs/clients/");
  const outline = page.getByRole("complementary", { name: "On this page" });

  const links = outline.locator("a[data-toc-link]");
  await expect(links.first()).toBeVisible();
  for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")))) {
    await expect(page.locator(`main ${href}`)).toHaveCount(1);
  }

  await outline.getByRole("link", { name: "Zed" }).click();
  await expect(page).toHaveURL(/#zed$/);
});

test("searches the docs from the keyboard", async ({ page }) => {
  await page.goto("/docs/");
  await page.keyboard.press("Control+k");

  const dialog = page.getByRole("dialog", { name: "Search the documentation" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("searchbox").fill("policy");
  await expect(dialog.locator("a[data-result]").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("keeps the results cleared when an earlier search finishes late", async ({ page }) => {
  await page.goto("/docs/");
  await page.keyboard.press("Control+k");

  const dialog = page.getByRole("dialog", { name: "Search the documentation" });
  const box = dialog.getByRole("searchbox");
  await box.fill("policy");
  await box.fill("");
  // Longer than Pagefind's debounce and the fetches behind it.
  await page.waitForTimeout(1500);

  await expect(dialog.locator("a[data-result]")).toHaveCount(0);
  await expect(dialog.getByText("Type to search every page.")).toBeVisible();
});

test("names the shortcut for the platform", async ({ page }) => {
  await page.goto("/docs/");
  await expect(page.locator("[data-shortcut-hint]")).toHaveText("Ctrl K");
});

test.describe("mobile docs", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the page index from the bar under the navbar", async ({ page }) => {
    await page.goto("/docs/policy/");
    const toggle = page.locator("#docs-menu-toggle");
    await expect(toggle).toContainText("What a project allows");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.locator("#docs-menu").getByRole("link", { name: "Exeora Cloud" }).click();
    await expect(page).toHaveURL(/\/docs\/cloud\/$/);
  });
});
