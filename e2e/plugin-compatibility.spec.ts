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
    await page.evaluate(() => document.fonts.ready);
    const rows = section.locator("[data-plugin-client]");
    await expect(rows).toHaveCount(5);
    for (const row of await rows.all()) {
      const steps = row.locator("[data-plugin-install-steps]");
      const download = row.locator("a[download]");
      await expect(steps).toBeVisible();
      await expect(download).toBeVisible();
      // Anchor navigation scrolls smoothly: compare all rectangles in one frame.
      const order = await row.evaluate((element) => {
        const notice = element.closest("section")?.querySelector("[data-chatgpt-import-notice]");
        const steps = element.querySelector("[data-plugin-install-steps]");
        const button = element.querySelector("a[download]");
        if (!notice || !steps || !button) throw new Error("Missing rendered guidance");
        const action = button.getBoundingClientRect();
        return {
          noticeBefore: notice.getBoundingClientRect().bottom < action.top,
          instructionsBefore: steps.getBoundingClientRect().bottom < action.top,
          documentOrder: Boolean(
            notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        };
      });
      expect(order).toEqual({ noticeBefore: true, instructionsBefore: true, documentOrder: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await section.screenshot({ path: test.info().outputPath(`compatibility-${width}.png`) });
  });
}
