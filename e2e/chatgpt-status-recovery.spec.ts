import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { chatgptReadyStatus } from "./integrations-mock.js";
import { mockWorkspaceV2 } from "./workspace-v2-mock.js";

for (const state of ["status_error", "pending"] as const) {
  test(`recovers ${state} with a status read without starting another registration`, async ({
    page,
  }) => {
    await signedIn(page);
    await mockWorkspaceV2(page, { ai: true });
    let reads = 0;
    let mutations = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/ai/chatgpt")) mutations += 1;
    });
    await page.route("**/api/devices/*/ai/chatgpt", async (route) => {
      reads += 1;
      if (reads === 1) {
        await route.fulfill(
          state === "status_error"
            ? {
                status: 503,
                json: { error: "ai_unavailable", message: "Temporary relay failure." },
              }
            : {
                status: 200,
                json: { state: "pending", pending: { expiresAt: Date.now() + 60_000 } },
              },
        );
      } else {
        await gate;
        await route.fulfill({ status: 200, json: chatgptReadyStatus });
      }
    });
    await openWorkspace(page, "/dashboard/settings");
    const row = page
      .locator("div.border-border-subtle.rounded-lg")
      .filter({ has: page.getByText("Laptop", { exact: true }) });
    await expect(row.getByRole("button", { name: "Continue with ChatGPT" })).toHaveCount(0);
    const retry = row.getByRole("button", {
      name: state === "pending" ? "Check sign-in" : "Retry connection",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect.poll(() => reads).toBe(2);
    if (state === "pending") {
      await expect(row.getByRole("button", { name: "Checking…", exact: true })).toBeDisabled();
    } else {
      await expect(row.getByText("Checking ChatGPT status…", { exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "Continue with ChatGPT" })).toHaveCount(0);
    }
    release?.();
    await expect(row.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
    expect(reads).toBe(2);
    expect(mutations).toBe(0);
  });
}

test("finishes sign-in despite a parent status refetch while completion is pending", async ({
  page,
}) => {
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true });
  let reads = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/devices/*/ai/chatgpt", async (route) => {
    reads += 1;
    if (reads === 3) await gate;
    await route.fulfill({
      status: 200,
      json: reads === 1 ? { state: "signed_out" } : chatgptReadyStatus,
    });
  });
  await openWorkspace(page, "/dashboard/settings");
  await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
  const login = page.getByRole("dialog", { name: "Continue with ChatGPT" });
  await expect.poll(() => reads, { timeout: 6_000 }).toBe(3);
  await expect(login).toBeVisible();
  release?.();
  await expect(login).toBeHidden({ timeout: 3_000 });
  const row = page
    .locator("div.border-border-subtle.rounded-lg")
    .filter({ has: page.getByText("Laptop", { exact: true }) });
  await expect(row.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(3);
});
