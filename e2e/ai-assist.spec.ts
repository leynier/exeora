import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { aiStatus, mockWorkspaceV2, project } from "./workspace-v2-mock.js";

test("writes a commit message from what is staged, unless the field moved on", async ({ page }) => {
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  const list = page.getByRole("complementary", { name: "Source Control" });
  const button = list.getByRole("button", { name: /Write a commit message/ });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleName("Write a commit message: Stage changes first");

  await list.getByRole("button", { name: "Stage all" }).click();
  await expect(button).toBeEnabled();
  await button.click();
  const message = list.getByRole("textbox", { name: "Commit message" });
  await expect(message).toHaveValue("Grow a tree\n\nBecause shade.");
  await expect(list.getByRole("button", { name: "Commit 2 files" })).toBeEnabled();
});

test("lists API-key OpenAI, local ChatGPT plan, and links Grok with a device code", async ({
  page,
}) => {
  let polls = 0;
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true });
  await page.route("**/api/ai/providers/xai/device", (route) =>
    route.fulfill({
      status: 200,
      json: {
        userCode: "ABCD-1234",
        verificationUrl: "https://accounts.x.ai/device",
        interval: 1,
        expiresAt: Date.now() + 60_000,
      },
    }),
  );
  await page.route("**/api/ai/providers/xai/device/poll", (route) => {
    polls += 1;
    return route.fulfill({
      status: 200,
      json:
        polls < 2
          ? { status: "pending" }
          : { status: "granted", linked: { kind: "oauth", accountLabel: "ada" } },
    });
  });
  await openWorkspace(page, "/dashboard/settings");
  const card = page
    .getByRole("region", { name: "AI Assist" })
    .or(page.locator("section", { hasText: "AI Assist" }).first());
  await expect(
    page
      .locator("p.text-title-md")
      .filter({ hasText: /^OpenAI API$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator("p.text-title-md")
      .filter({ hasText: /^ChatGPT plan$/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(aiStatus.providers[0]?.linked?.accountLabel ?? "")).toBeVisible();
  await expect(page.getByText("API key", { exact: true })).toBeVisible();
  await expect(page.getByText("Old sign-in", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Link subscription" }).click();
  const dialog = page.getByRole("dialog", { name: "Link Grok" });
  await expect(dialog.getByText("ABCD-1234")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open the provider's page" })).toHaveAttribute(
    "href",
    "https://accounts.x.ai/device",
  );
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => polls).toBeGreaterThanOrEqual(2);
  void card;
});
