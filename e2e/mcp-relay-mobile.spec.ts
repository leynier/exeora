import { expect, test } from "@playwright/test";
import { openInHost } from "./mcp-host.js";
import { relayGateway } from "./panel-relay.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

/**
 * ChatGPT's control of the Workspace panel on a phone-width panel: the
 * status and Stop stay on screen beside the header's other controls.
 */

const PANEL = "7d0f2c8e-4a51-4b8e-9b0e-1f2a3b4c5d6e";

test("keeps the control status and Stop within a narrow panel", async ({ page }) => {
  const gateway = await relayGateway(page);
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
        panelId: PANEL,
      },
    },
    relay: { panelId: PANEL },
  });
  await gateway.connect(0, PANEL);
  const chip = panel.getByRole("region", { name: "ChatGPT control" });
  await expect(chip.getByRole("status")).toHaveText("ChatGPT can move this panel");
  const width = page.viewportSize()?.width ?? 0;
  for (const target of [chip, chip.getByRole("button", { name: "Stop" })]) {
    const box = await target.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("relay-mobile.png") });
  await chip.getByRole("button", { name: "Stop" }).click();
  await expect(chip.getByRole("button", { name: "Resume" })).toBeInViewport();
});
