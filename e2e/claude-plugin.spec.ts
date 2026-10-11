import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

for (const width of [1280, 390]) {
  test(`downloads the Claude web upload and preserves the ChatGPT route at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/docs/claude-plugin/");
    await expect(
      page.getByRole("heading", { name: "Exeora for Claude web", exact: true }),
    ).toBeVisible();
    const link = page.getByRole("link", { name: "Download Claude plugin", exact: true });
    await expect(link).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const pending = page.waitForEvent("download");
    await link.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("exeora-claude.plugin");
    const path = await download.path();
    expect(path).toBeTruthy();
    const entries = unzipSync(new Uint8Array(readFileSync(path as string)));
    expect(JSON.parse(Buffer.from(entries[".claude-plugin/plugin.json"]).toString()).name).toBe(
      "exeora-workspaces",
    );
    await page.getByRole("link", { name: "ChatGPT and Codex plugin", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Download plugin ZIP", exact: true }),
    ).toHaveAttribute("href", "/downloads/exeora-plugin.zip");
  });
}
