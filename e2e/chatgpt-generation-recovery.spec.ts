import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import {
  aiStatus,
  type ChatgptLoginFixture,
  type ChatgptStatusFixture,
  chatgptLogin,
  chatgptOnlyAiStatus,
  chatgptReadyStatus,
  chatgptStatus,
} from "./integrations-mock.js";
import { mockWorkspaceV2 } from "./workspace-v2-mock.js";

function loginFixture(): ChatgptLoginFixture {
  return { ...chatgptLogin, expiresAt: Date.now() + 60_000 };
}

function readyStatus(
  newRegistration = false,
  email = "ada@example.com",
): ChatgptStatusFixture & { account: NonNullable<ChatgptStatusFixture["account"]> } {
  return {
    ...chatgptReadyStatus,
    account: {
      label: email,
      email,
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      planUsage: true,
      newRegistration,
    },
  };
}

test.describe("official ChatGPT generation recovery", () => {
  test("keeps ChatGPT notices below editable commit and pull request fields", async ({ page }) => {
    await signedIn(page);
    await mockWorkspaceV2(page, {
      github: { pullRequest: null },
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: { projectStatus: readyStatus(), status: readyStatus() },
    });
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");
    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    const message = sourceControl.getByRole("textbox", { name: "Commit message" });
    const commitNotice = sourceControl.getByText("Using ChatGPT plan", { exact: false });
    await expect(commitNotice).toBeVisible();
    const fieldBounds = await message.boundingBox();
    const noticeBounds = await commitNotice.boundingBox();
    if (!fieldBounds || !noticeBounds) throw new Error("Commit field and notice must be visible.");
    expect(noticeBounds.y).toBeGreaterThanOrEqual(fieldBounds.y + fieldBounds.height);
    await message.fill("Editable commit text");
    await expect(message).toHaveValue("Editable commit text");
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e&view=pr");
    const panel = page.getByRole("complementary", { name: "Pull Request" });
    const title = panel.getByRole("textbox", { name: "Title" });
    const prNotice = panel.getByText("Using ChatGPT plan", { exact: false });
    await expect(prNotice).toBeVisible();
    const titleBounds = await title.boundingBox();
    const prNoticeBounds = await prNotice.boundingBox();
    if (!titleBounds || !prNoticeBounds) throw new Error("PR field and notice must be visible.");
    expect(prNoticeBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height);
    await title.fill("Editable pull request title");
    await expect(title).toHaveValue("Editable pull request title");
  });

  test("does not offer an unavailable OpenAI key path after declining plan usage", async ({
    page,
  }) => {
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: {
        status: {
          ...readyStatus(false),
          state: "plan_disabled",
          account: {
            ...readyStatus(false).account,
            scopes: ["openid"],
            planUsage: false,
          },
        },
      },
    });
    await openWorkspace(page, "/dashboard/settings");
    await expect(page.getByRole("button", { name: "Enable ChatGPT plan usage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use an OpenAI API key" })).toHaveCount(0);
  });

  test("keeps cancellation retry available when the machine does not acknowledge it", async ({
    page,
  }) => {
    let cancels = 0;
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: { projectStatus: chatgptStatus, status: chatgptStatus, login: () => loginFixture() },
    });
    await page.route("**/api/devices/*/ai/chatgpt/login/cancel", (route) => {
      cancels += 1;
      return route.fulfill({
        status: cancels === 1 ? 503 : 200,
        json:
          cancels === 1
            ? { error: "ai_unavailable", message: "Cancellation temporarily unavailable." }
            : { ok: true },
      });
    });
    await page.route("**/api/projects/*/ai/commit-message", (route) =>
      route.fulfill({
        status: 409,
        json: { error: "ai_chatgpt_signin", deviceId: "dev_e2e" },
      }),
    );
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");
    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    await sourceControl.getByRole("button", { name: "Write a commit message" }).click();
    const dialog = page.getByRole("dialog", { name: "Continue with ChatGPT" });
    await expect(dialog.getByRole("link", { name: "Open ChatGPT sign-in" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Cancellation temporarily unavailable.");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => cancels).toBe(2);
    await expect(dialog).toBeHidden();
  });

  for (const cancelWith of ["button", "escape"] as const) {
    test(`cancels a delayed login startup with ${cancelWith}`, async ({ page }) => {
      let starts = 0;
      let cancels = 0;
      let releaseStart: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
      await signedIn(page);
      await mockWorkspaceV2(page, {
        ai: true,
        aiStatus: chatgptOnlyAiStatus,
        chatgpt: { projectStatus: chatgptStatus, status: chatgptStatus },
      });
      await page.route("**/api/devices/*/ai/chatgpt/login", async (route) => {
        starts += 1;
        await started;
        await route.fulfill({ json: loginFixture() });
      });
      await page.route("**/api/devices/*/ai/chatgpt/login/cancel", (route) => {
        cancels += 1;
        return route.fulfill({ json: { ok: true } });
      });
      await page.route("**/api/projects/*/ai/commit-message", (route) =>
        route.fulfill({
          status: 409,
          json: { error: "ai_chatgpt_signin", deviceId: "dev_e2e" },
        }),
      );
      await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");
      const sourceControl = page.getByRole("complementary", { name: "Source Control" });
      await sourceControl.getByRole("button", { name: "Stage all" }).click();
      await sourceControl.getByRole("button", { name: "Write a commit message" }).click();
      await expect.poll(() => starts).toBe(1);
      const dialog = page.getByRole("dialog", { name: "Continue with ChatGPT" });
      if (cancelWith === "escape") await page.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(cancels).toBe(0);
      releaseStart();
      await expect.poll(() => cancels).toBe(1);
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("dialog", { name: "You're using your ChatGPT plan" }),
      ).toHaveCount(0);
    });
  }

  test("offers a retry after an offline lookup and restores generation when the machine connects", async ({
    page,
  }) => {
    let connected = false;
    const generationBodies: unknown[] = [];
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: { projectStatus: () => readyStatus(false) },
    });
    await page.route("**/api/projects/*/ai/chatgpt*", (route) =>
      route.fulfill({
        status: connected ? 200 : 409,
        json: connected ? readyStatus(false) : { error: "ai_machine_offline" },
      }),
    );
    await page.route("**/api/projects/*/ai/commit-message", (route) => {
      generationBodies.push(route.request().postDataJSON());
      return route.fulfill({ json: { message: "feat: recover connection", provider: "chatgpt" } });
    });
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");
    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    const retry = sourceControl.getByRole("button", { name: "Retry ChatGPT connection" });
    await expect(retry).toBeVisible();
    connected = true;
    await retry.click();
    const generate = sourceControl.getByRole("button", { name: "Write a commit message" });
    await expect(generate).toBeVisible();
    await generate.click();
    await expect.poll(() => generationBodies.length).toBe(1);
    expect(generationBodies[0]).toMatchObject({ provider: "chatgpt" });
  });

  test("uses fresh client-invalid state to start a new registration after generation fails", async ({
    page,
  }) => {
    const loginModes: string[] = [];
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: {
        projectStatus: () => readyStatus(false),
        status: () => ({ ...readyStatus(false), state: "client_invalid" }),
        login: ({ mode }) => {
          loginModes.push(mode);
          return loginFixture();
        },
      },
    });
    await page.route("**/api/projects/*/ai/commit-message", (route) =>
      route.fulfill({
        status: 409,
        json: { error: "ai_chatgpt_signin", deviceId: "dev_e2e" },
      }),
    );
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");
    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    await sourceControl.getByRole("button", { name: "Write a commit message" }).click();
    await expect.poll(() => loginModes).toEqual(["new"]);
  });

  for (const configuredBy of ["default", "operation"] as const) {
    test(`preserves the ${configuredBy} ChatGPT choice when its status lookup fails`, async ({
      page,
    }) => {
      const generationBodies: unknown[] = [];
      await signedIn(page);
      await mockWorkspaceV2(page, {
        ai: true,
        aiStatus: {
          ...aiStatus,
          settings: {
            ...aiStatus.settings,
            defaultProvider: configuredBy === "default" ? "chatgpt" : "openai",
            operations: {
              ...aiStatus.settings.operations,
              commit: {
                ...aiStatus.settings.operations.commit,
                provider: configuredBy === "operation" ? "chatgpt" : null,
              },
            },
          },
        },
      });
      await page.route("**/api/projects/*/ai/chatgpt*", (route) =>
        route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } }),
      );
      await page.route("**/api/projects/*/ai/commit-message", async (route) => {
        generationBodies.push(route.request().postDataJSON());
        await route.fulfill({ status: 503, json: { error: "ai_chatgpt_unavailable" } });
      });
      await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");
      const sourceControl = page.getByRole("complementary", { name: "Source Control" });
      await sourceControl.getByRole("button", { name: "Stage all" }).click();
      await sourceControl.getByRole("button", { name: "Write a commit message" }).click();
      await expect.poll(() => generationBodies.length).toBe(1);
      expect(generationBodies[0]).toMatchObject({ provider: "chatgpt" });
    });
  }

  test("keeps a rejected reauthentication visible while the previous account remains ready", async ({
    page,
  }) => {
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: {
        projectStatus: () => readyStatus(false),
        status: ({ loginMode }) => ({
          ...readyStatus(false),
          loginError: loginMode ? "invalid_id_token" : null,
        }),
        login: () => loginFixture(),
      },
    });
    await page.route("**/api/projects/*/ai/commit-message", (route) =>
      route.fulfill({
        status: 409,
        json: { error: "ai_chatgpt_signin", deviceId: "dev_e2e" },
      }),
    );
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");
    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    await sourceControl.getByRole("button", { name: "Write a commit message" }).click();
    const dialog = page.getByRole("dialog", { name: "Continue with ChatGPT" });
    await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "You're using your ChatGPT plan" })).toHaveCount(
      0,
    );
  });

  test("shows the welcome after first sign-in started from commit generation", async ({ page }) => {
    let loginPolls = 0;
    let completed = false;
    const loginModes: string[] = [];
    const generationBodies: unknown[] = [];
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: {
        projectStatus: () => (completed ? readyStatus(true) : chatgptStatus),
        status: ({ loginMode }) => {
          if (!loginMode) return chatgptStatus;
          loginPolls += 1;
          completed = true;
          return readyStatus(true);
        },
        login: ({ mode }) => {
          loginModes.push(mode);
          return loginFixture();
        },
      },
    });
    await page.route("**/api/projects/*/ai/commit-message", async (route) => {
      generationBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: {
          error: "ai_chatgpt_signin",
          message: "Sign in with ChatGPT on the machine that runs this workspace.",
          deviceId: "dev_e2e",
        },
      });
    });
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");

    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    await sourceControl.getByRole("button", { name: "Write a commit message" }).click();

    await expect.poll(() => generationBodies.length, { timeout: 5_000 }).toBe(1);
    expect(generationBodies[0]).toMatchObject({ provider: "chatgpt" });
    await expect.poll(() => loginModes, { timeout: 5_000 }).toEqual(["new"]);
    await expect.poll(() => loginPolls, { timeout: 10_000 }).toBeGreaterThan(0);
    const welcome = page.getByRole("dialog", { name: "You're using your ChatGPT plan" });
    await expect(welcome).toBeVisible({ timeout: 3_000 });
    await expect(welcome).toContainText("Exeora never receives your ChatGPT tokens.");
  });

  test("retries a client-invalid returning login with a new registration", async ({ page }) => {
    const loginModes: string[] = [];
    const generationBodies: unknown[] = [];
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: {
        projectStatus: () => readyStatus(false),
        status: ({ loginMode }) =>
          loginMode
            ? { state: "client_invalid", loginError: "client_invalid" }
            : readyStatus(false),
        login: ({ mode }) => {
          loginModes.push(mode);
          return loginFixture();
        },
      },
    });
    await page.route("**/api/projects/*/ai/commit-message", async (route) => {
      generationBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: {
          error: "ai_chatgpt_signin",
          message: "ChatGPT sign-in is required.",
          deviceId: "dev_e2e",
        },
      });
    });
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");

    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    await sourceControl.getByRole("button", { name: "Write a commit message" }).click();

    await expect.poll(() => generationBodies.length, { timeout: 5_000 }).toBe(1);
    expect(generationBodies[0]).toMatchObject({ provider: "chatgpt" });
    await expect.poll(() => loginModes, { timeout: 5_000 }).toEqual(["reauth"]);
    const dialog = page.getByRole("dialog", { name: "Continue with ChatGPT" });
    await expect(dialog.getByRole("alert")).toHaveText(
      "This machine's ChatGPT registration is no longer valid.",
      { timeout: 10_000 },
    );
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => loginModes, { timeout: 5_000 }).toEqual(["reauth", "new"]);
    expect(loginModes.filter((mode) => mode === "reauth")).toHaveLength(1);
  });
});
