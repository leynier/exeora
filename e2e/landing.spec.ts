import { expect, test } from "@playwright/test";

test("selects the detected desktop installer and copies the command", async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { platform: "Windows" },
    });
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  const installer = page.locator("[data-install-selector]").first();
  const firstPlatform = installer.locator("[data-install-platform]").first();
  await expect(firstPlatform).toHaveAttribute("data-install-platform", "windows");
  await expect(firstPlatform).toHaveAttribute("aria-pressed", "true");
  await expect(installer.locator("[data-install-command]")).toContainText("install.ps1");

  const copy = installer.locator('[data-copy-target$="-connect"]');
  await copy.click();
  await expect(copy).toContainText("Copied");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("exeora connect");
});

test.describe("mobile landing", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    viewport: { width: 390, height: 844 },
  });

  test("explains the desktop boundary before offering an installer", async ({ page }) => {
    await page.goto("/");
    const installer = page.locator("[data-install-selector]").first();

    await expect(installer.locator("[data-install-mobile-hint]")).toBeVisible();
    await expect(installer.locator("[data-install-copy]")).toBeDisabled();
    await expect(installer.locator('[aria-pressed="true"]')).toHaveCount(0);

    await installer.locator('[data-install-platform="linux"]').click();
    await expect(installer.locator("[data-install-mobile-hint]")).toBeHidden();
    await expect(installer.locator("[data-install-copy]")).toBeEnabled();
    await expect(installer.locator("[data-install-command]")).toContainText("linux/install.sh");
  });

  test("closes the navigation menu with Escape and restores focus", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("#nav-menu-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  });
});

test("reports clipboard refusal instead of claiming success", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.goto("/");

  const copy = page.locator("[data-copy-target]").first();
  await copy.click();
  await expect(copy).toContainText("Copy failed");
});
