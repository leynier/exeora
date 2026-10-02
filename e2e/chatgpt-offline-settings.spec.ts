import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { laptop } from "./fixtures.js";
import {
  type ChatgptStatusFixture,
  chatgptOnlyAiStatus,
  chatgptReadyStatus,
} from "./integrations-mock.js";
import { mockWorkspaceV2 } from "./workspace-v2-mock.js";

for (const state of ["ready", "plan_disabled", "reconnect", "client_invalid"] as const) {
  test(`retires cached ${state} actions and settings when the machine disconnects`, async ({
    page,
  }) => {
    let online = true;
    let accountMutations = 0;
    const status: ChatgptStatusFixture = { ...chatgptReadyStatus, state };
    await page.clock.install();
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: { status },
      onRequest: (request) => {
        if (request.method() === "POST" && request.url().includes("/ai/chatgpt/")) {
          accountMutations += 1;
        }
      },
    });
    await page.route("**/api/machines", (route) =>
      route.fulfill({ status: 200, json: { machines: [{ ...laptop, online }] } }),
    );
    await openWorkspace(page, "/dashboard/settings");
    const action =
      state === "ready"
        ? "Sign out"
        : state === "plan_disabled"
          ? "Enable ChatGPT plan usage"
          : "Continue with ChatGPT";
    // The header also has Sign out; scope the account's machine row.
    const row = page.locator("div.border-border-subtle.rounded-lg").filter({
      has: page.getByText("Laptop", { exact: true }),
    });
    await expect(row.getByRole("button", { name: action, exact: true })).toBeVisible();
    if (state === "ready") {
      await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
    }
    online = false;
    await page.clock.fastForward(15_000);
    await expect(
      row.getByText("Connect a machine with the Exeora CLI to use your ChatGPT plan.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(row.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Enable ChatGPT plan usage" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Continue with ChatGPT" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
    expect(accountMutations).toBe(0);
  });
}
