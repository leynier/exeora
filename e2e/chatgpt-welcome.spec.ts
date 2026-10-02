import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { chatgptReadyStatus } from "./integrations-mock.js";
import { mockWorkspaceV2 } from "./workspace-v2-mock.js";

const noticeId = "123e4567-e89b-42d3-a456-426614174000";
function readyStatus(newRegistration = false) {
  return {
    ...chatgptReadyStatus,
    account: {
      label: "ada@example.com",
      email: "ada@example.com",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      planUsage: true,
      newRegistration,
      ...(newRegistration ? { noticeId } : {}),
    },
  };
}

test("waits for saved machine status before offering a new registration", async ({ page }) => {
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let statusStarted = false;
  let logins = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/ai/chatgpt/login")) logins += 1;
  });
  await page.route("**/api/devices/*/ai/chatgpt", async (route) => {
    statusStarted = true;
    await gate;
    await route.fulfill({ status: 200, json: readyStatus() });
  });
  await openWorkspace(page, "/dashboard/settings");
  await expect.poll(() => statusStarted).toBe(true);
  await expect(page.getByText("Checking ChatGPT status…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with ChatGPT" })).toHaveCount(0);
  release?.();
  const row = page
    .locator("div.border-border-subtle.rounded-lg")
    .filter({ has: page.getByText("Laptop", { exact: true }) });
  await expect(row.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect(logins).toBe(0);
});

test("background reads retain welcome and failed acknowledgement can be retried", async ({
  page,
}) => {
  await signedIn(page);
  let acknowledged = false;
  let reads = 0;
  let attempts = 0;
  await mockWorkspaceV2(page, {
    ai: true,
    chatgpt: {
      status: () => {
        reads += 1;
        return readyStatus(!acknowledged);
      },
    },
  });
  await page.route("**/api/devices/*/ai/chatgpt/welcome", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      noticeId: "123e4567-e89b-42d3-a456-426614174000",
    });
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { error: "ai_unavailable", message: "Machine disconnected. Try again." },
      });
    } else {
      acknowledged = true;
      await route.fulfill({ status: 200, json: { acknowledged: true } });
    }
  });
  await openWorkspace(page, "/dashboard/settings");
  const welcome = page.getByRole("dialog", { name: "You're using your ChatGPT plan" });
  await expect(welcome).toBeVisible();
  expect(reads).toBeGreaterThan(0);
  expect(attempts).toBe(0);
  await welcome.getByRole("button", { name: "Got it" }).click();
  await expect(welcome.getByRole("alert")).toContainText("Machine disconnected.");
  await expect(welcome).toBeVisible();
  expect(acknowledged).toBe(false);
  await welcome.getByRole("button", { name: "Try again" }).click();
  await expect(welcome).toBeHidden();
  await openWorkspace(page, "/dashboard/settings");
  await expect(
    page.getByText("ada@example.com · Plan usage allowed", { exact: true }),
  ).toBeVisible();
  await expect(welcome).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(reads).toBeGreaterThan(1);
});

test("allows closing an unconfirmed notice while retaining it for the next visit", async ({
  page,
}) => {
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true, chatgpt: { status: readyStatus(true) } });
  let acknowledgements = 0;
  await page.route("**/api/devices/*/ai/chatgpt/welcome", async (route) => {
    acknowledgements += 1;
    await route.fulfill({
      status: 503,
      json: { error: "ai_unavailable", message: "Machine disconnected." },
    });
  });
  await openWorkspace(page, "/dashboard/settings");
  const welcome = page.getByRole("dialog", { name: "You're using your ChatGPT plan" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Got it" }).click();
  await expect(welcome.getByRole("alert")).toBeVisible();
  await welcome.getByRole("button", { name: "Close for now" }).click();
  await expect(welcome).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
  expect(acknowledgements).toBe(1);
  await openWorkspace(page, "/dashboard/settings");
  await expect(welcome).toBeVisible();
  expect(acknowledgements).toBe(1);
});
