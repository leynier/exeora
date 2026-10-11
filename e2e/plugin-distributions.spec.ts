import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

const distributions = [
  {
    label: "GrokBot Cursor",
    route: "grokbot-cursor",
    file: "grokbot-cursor-plugin",
    manifest: ".cursor-plugin/plugin.json",
    name: "grokbot-cursor",
  },
  {
    label: "Agent Plugin",
    route: "agent-plugin",
    file: "exeora-agent-plugin",
    manifest: "plugin.json",
    name: "exeora-agent-plugin",
  },
  {
    label: "GitHub Copilot",
    route: "copilot-plugin",
    file: "exeora-copilot-plugin",
    manifest: "plugin.json",
    name: "exeora-copilot",
  },
];

for (const width of [1280, 390]) {
  for (const { label, route, file, manifest, name } of distributions) {
    test(`downloads and verifies ${label} at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/docs/${route}/`);
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const pending = page.waitForEvent("download");
      await page.getByRole("link", { name: `Download ${label} ZIP`, exact: true }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(`${file}.zip`);
      const path = await download.path();
      expect(path).toBeTruthy();
      const bytes = readFileSync(path as string);
      const entries = unzipSync(new Uint8Array(bytes));
      const identity = JSON.parse(Buffer.from(entries[manifest]).toString());
      expect(identity.name).toBe(name);
      const metadata = await (await request.get(`/downloads/${file}.json`)).json();
      expect(metadata.displayName).toBe(label);
      expect(metadata.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      await page.getByRole("link", { name: "All five distributions", exact: true }).click();
      for (const target of [
        "/docs/plugin/",
        "/docs/claude-plugin/",
        ...distributions.map(({ route }) => `/docs/${route}/`),
      ]) {
        await expect(page.locator(`main table a[href="${target}"]`)).toBeVisible();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
}
