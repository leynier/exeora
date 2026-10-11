import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`explains compatibility before every plugin download at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#plugin-installation");
    const section = page.locator("#plugin-installation");
    const notice = section.locator("[data-chatgpt-import-notice]");
    await expect(
      section.getByRole("heading", { name: "Plugin compatibility and installation" }),
    ).toBeVisible();
    await expect(notice).toContainText("Desktop-only");
    await expect(notice).toContainText("remote HTTPS");
    await expect(notice).toContainText("without manually registering a URL");
    await expect(notice).toContainText("OAuth sign-in may still be required");
    await expect(notice.getByRole("link", { name: "Public publication process" })).toHaveAttribute(
      "href",
      "https://developers.openai.com/plugins/deploy/submission",
    );
    const rows = section.locator("[data-plugin-client]");
    await expect(rows).toHaveCount(5);
    for (const row of await rows.all()) {
      const steps = row.locator("[data-plugin-install-steps]");
      const download = row.locator("a[download]");
      await expect(steps).toBeVisible();
      await expect(download).toBeVisible();
      const before = await notice.boundingBox();
      const instructions = await steps.boundingBox();
      const button = await download.boundingBox();
      if (!before || !instructions || !button) throw new Error("Missing rendered guidance");
      expect(before.y + before.height).toBeLessThan(button.y);
      expect(instructions.y + instructions.height).toBeLessThan(button.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await section.screenshot({ path: test.info().outputPath(`compatibility-${width}.png`) });
  });
}
