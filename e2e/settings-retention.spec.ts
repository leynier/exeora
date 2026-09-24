import { expect, test } from "@playwright/test";
import { mockApi, openWorkspace, signedIn, user } from "./dashboard-mock";

for (const retentionDays of [1, 365]) {
  test(`Settings shows ${retentionDays}-day retention with the correct label`, async ({ page }) => {
    await signedIn(page);
    await mockApi(page);
    await page.route("**/api/me", (route) =>
      route.fulfill({
        status: 200,
        json: { ...user, limits: { ...user.limits, retentionDays } },
      }),
    );
    await openWorkspace(page, "/dashboard/settings");

    const label = `${retentionDays} ${retentionDays === 1 ? "day" : "days"}`;
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText("1 days", { exact: true })).toHaveCount(0);
  });
}
