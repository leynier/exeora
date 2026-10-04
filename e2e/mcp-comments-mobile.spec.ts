import { expect, test } from "@playwright/test";
import { hostLog, openInHost } from "./mcp-host.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

/**
 * The comment flow on a phone-width ChatGPT panel, against the simulated
 * MCP Apps host: every control reachable, the dialogs within the screen.
 */

test("comments and adds them on a narrow panel", async ({ page }) => {
  await mockWorkspaceV2(page);
  const panel = await openInHost(page, {
    context: { displayMode: "fullscreen", availableDisplayModes: ["fullscreen"] },
    input: { project: project.id, path: "src/main.ts" },
    result: {
      structuredContent: {
        projectId: project.id,
        workspace: null,
        path: "src/main.ts",
        tab: "explorer",
      },
    },
  });
  const editor = panel.locator(".cm-content");
  await expect(editor).toContainText("export const answer = 42;");
  await editor.locator(".cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await panel.getByRole("button", { name: "Comment on the selection" }).click();

  const composer = panel.getByRole("dialog", { name: "Comment on the selection" });
  const width = page.viewportSize()?.width ?? 0;
  const box = await composer.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
  await composer.getByLabel("Comment").fill("From a phone");
  await composer.getByRole("button", { name: "Add comment" }).click();

  await panel.getByRole("button", { name: "Comments, 1 waiting" }).click();
  const review = panel.getByRole("dialog", { name: "Comments" });
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByRole("region", { name: "Attached to context" })).toBeVisible();
  expect((await hostLog(page)).modelContexts.at(-1)?.content?.[0]?.text).toContain(
    "Comment: From a phone",
  );
});
