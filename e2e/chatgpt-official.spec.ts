import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { laptop } from "./fixtures.js";
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

function readyStatus(newRegistration = false, email = "ada@example.com"): ChatgptStatusFixture {
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

function accountStatus(
  state: ChatgptStatusFixture["state"],
  email = "ada@example.com",
): ChatgptStatusFixture {
  return {
    state,
    account: {
      label: email,
      email,
      scopes: ["openid"],
      planUsage: state === "ready",
      newRegistration: false,
    },
  };
}

test.describe("official ChatGPT plan flow", () => {
  test("shows a per-machine official URL and completes pending sign-in with a welcome", async ({
    page,
  }) => {
    let pollRequests = 0;
    const loginModes: string[] = [];
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: {
        status: ({ loginMode }) => {
          if (!loginMode) return chatgptStatus;
          pollRequests += 1;
          return pollRequests === 1
            ? { state: "pending", pending: { expiresAt: Date.now() + 60_000 } }
            : readyStatus(true);
        },
        login: ({ mode }) => {
          loginModes.push(mode);
          return loginFixture();
        },
      },
    });
    await openWorkspace(page, "/dashboard/settings");

    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    const dialog = page.getByRole("dialog", { name: "Continue with ChatGPT" });
    await expect(dialog).toContainText("On another computer, run exeora chatgpt login there.");
    const signIn = dialog.getByRole("link", { name: "Open ChatGPT sign-in" });
    const href = await signIn.getAttribute("href");
    expect(href).toBeTruthy();
    const authorize = new URL(href ?? "");
    expect(authorize.origin).toBe("https://auth.openai.com");
    expect(authorize.pathname).toBe("/api/accounts/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
    );
    expect(authorize.searchParams.has("id_token_hint")).toBe(false);
    await expect(signIn).toHaveAttribute("target", "_blank");
    expect(loginModes).toEqual(["new"]);

    await expect.poll(() => pollRequests, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("dialog", { name: "You're using your ChatGPT plan" })).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByText("Plan usage allowed.", { exact: true })).toBeVisible();
  });

  test("retries with enable-plan after a sign-in that withheld plan usage", async ({ page }) => {
    let requestedMode: string | undefined;
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: {
        status: ({ loginMode }) => (loginMode ? readyStatus() : accountStatus("plan_disabled")),
        login: ({ mode }) => {
          requestedMode = mode;
          return loginFixture();
        },
      },
    });
    await openWorkspace(page, "/dashboard/settings");

    await expect(page.getByRole("button", { name: "Enable ChatGPT plan usage" })).toBeVisible();
    await page.getByRole("button", { name: "Enable ChatGPT plan usage" }).click();
    await expect.poll(() => requestedMode, { timeout: 5_000 }).toBe("enable_plan");
    await expect(page.getByRole("dialog", { name: "Continue with ChatGPT" })).toBeHidden({
      timeout: 8_000,
    });
    await expect(page.getByText("Plan usage allowed.", { exact: true })).toBeVisible();
  });

  test("stops polling and surfaces a safe login error", async ({ page }) => {
    let postLoginStatusRequests = 0;
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: {
        status: ({ loginMode }) => {
          if (!loginMode) return chatgptStatus;
          postLoginStatusRequests += 1;
          return { state: "pending", loginError: "temporarily_unavailable" };
        },
        login: () => loginFixture(),
      },
    });
    await openWorkspace(page, "/dashboard/settings");

    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    const dialog = page.getByRole("dialog", { name: "Continue with ChatGPT" });
    await expect(dialog.getByRole("alert")).toHaveText(
      "ChatGPT is temporarily unavailable. Try again shortly.",
      { timeout: 8_000 },
    );
    expect(postLoginStatusRequests).toBe(1);
    await page.waitForTimeout(2_300);
    expect(postLoginStatusRequests).toBe(1);
  });

  test("shows Manage usage for a ChatGPT 429 without falling back to credentials", async ({
    page,
  }) => {
    const generationBodies: unknown[] = [];
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: { status: chatgptReadyStatus },
    });
    await page.route("**/api/projects/*/ai/commit-message", async (route) => {
      generationBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 429,
        json: {
          error: "ai_usage_limit",
          message: "ChatGPT usage limit reached.",
          manageUsageUrl: "https://chatgpt.com/settings/usage",
        },
      });
    });
    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e");

    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    await sourceControl
      .getByRole("button", { name: "Write a commit message (choose a provider)" })
      .click();
    await page.getByRole("menuitem", { name: /^ChatGPT plan/ }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Usage limit reached for");
    await expect(alert.getByRole("link", { name: "Manage usage" })).toHaveAttribute(
      "href",
      "https://chatgpt.com/settings/usage",
    );
    expect(generationBodies).toHaveLength(1);
    expect(generationBodies[0]).toMatchObject({ provider: "chatgpt" });
  });

  test("keeps legacy OpenAI links explicit and starts machine reauthentication", async ({
    page,
  }) => {
    let removed = false;
    let loginMode: string | undefined;
    const statusWithLegacy = () => ({
      ...aiStatus,
      providers: aiStatus.providers.map((provider) =>
        provider.id === "openai"
          ? {
              ...provider,
              linked: removed
                ? null
                : { kind: "oauth", accountLabel: "old@example.com", legacy: true },
            }
          : provider,
      ),
    });
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: {
        status: { state: "reconnect" },
        login: ({ mode }) => {
          loginMode = mode;
          return loginFixture();
        },
      },
    });
    await page.route("**/api/ai", (route) =>
      route.fulfill({ status: 200, json: statusWithLegacy() }),
    );
    await page.route("**/api/ai/providers/openai", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      removed = true;
      await route.fulfill({ status: 200, json: { ok: true } });
    });
    await openWorkspace(page, "/dashboard/settings");

    await expect(page.getByText("Old sign-in", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect.poll(() => loginMode, { timeout: 5_000 }).toBe("reauth");
    const loginDialog = page.getByRole("dialog", { name: "Continue with ChatGPT" });
    await loginDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(loginDialog).toBeHidden();

    await page.getByRole("button", { name: "Remove old link" }).click();
    const confirm = page.getByRole("dialog", { name: "Remove old sign-in?" });
    await confirm.getByRole("button", { name: "Remove old link" }).click();
    await expect.poll(() => removed).toBe(true);
    await expect(page.getByText("Old sign-in", { exact: true })).toHaveCount(0);
    const openAiRow = page
      .getByText("OpenAI API", { exact: true })
      .locator("..")
      .locator("..")
      .locator("..");
    await expect(openAiRow.getByRole("button", { name: "Use an API key" })).toBeVisible();
  });

  test("makes old CLI, cloud-only, and offline states clear", async ({ page }) => {
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: { status: chatgptStatus },
    });
    await page.route("**/api/devices/*/ai/chatgpt", async (route) => {
      await route.fulfill({
        status: 409,
        json: { error: "ai_update_cli", message: "Update the Exeora CLI on this machine." },
      });
    });
    await openWorkspace(page, "/dashboard/settings");

    await expect(
      page.getByText("Update the Exeora CLI on Laptop to sign in with ChatGPT.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy exeora upgrade" })).toBeVisible();
  });

  test("shows the cloud and offline boundaries without offering a login", async ({ page }) => {
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: { status: { state: "unavailable_on_cloud" } },
    });
    await openWorkspace(page, "/dashboard/settings");
    await expect(
      page.getByText("Not available on Exeora Cloud machines.", { exact: true }),
    ).toBeVisible();

    await page.route("**/api/machines", (route) =>
      route.fulfill({ status: 200, json: { machines: [{ ...laptop, online: false }] } }),
    );
    await openWorkspace(page, "/dashboard/settings");
    await expect(
      page.getByText("Connect a machine with the Exeora CLI to use your ChatGPT plan.", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("uses the active workspace account when several machines are ready", async ({ page }) => {
    const desktop = {
      ...laptop,
      deviceId: "dev_desktop",
      name: "Desktop",
      projects: [],
    };
    const projectStatusRequests: { workspace: string | undefined }[] = [];
    const deviceStatusRequests: string[] = [];
    const generationRequests: { body: unknown; url: string }[] = [];
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      onRequest: (request) => {
        if (request.url().includes("/api/devices/") && request.url().endsWith("/ai/chatgpt")) {
          deviceStatusRequests.push(request.url());
        }
      },
      chatgpt: {
        status: ({ deviceId }) =>
          readyStatus(false, deviceId === "dev_desktop" ? "bob@example.com" : "ada@example.com"),
        projectStatus: ({ workspace }) => {
          projectStatusRequests.push({ workspace });
          return readyStatus(false, "ada@example.com");
        },
      },
    });
    await page.route("**/api/machines", (route) =>
      route.fulfill({ status: 200, json: { machines: [desktop, laptop] } }),
    );
    await page.route("**/api/projects/*/ai/commit-message**", async (route) => {
      generationRequests.push({ body: route.request().postDataJSON(), url: route.request().url() });
      await route.fulfill({
        status: 200,
        json: {
          message: "Use the active workspace account.",
          provider: "chatgpt",
          model: "gpt-5.5",
        },
      });
    });

    await openWorkspace(page, "/dashboard/settings");
    await expect(page.getByText("Laptop", { exact: true })).toBeVisible();
    await expect(page.getByText("Desktop", { exact: true })).toBeVisible();
    await expect(page.getByText("ada@example.com", { exact: true })).toBeVisible();
    expect(deviceStatusRequests).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/api/devices/dev_desktop/ai/chatgpt"),
        expect.stringContaining("/api/devices/dev_e2e/ai/chatgpt"),
      ]),
    );
    await expect(page.getByText("bob@example.com", { exact: false })).toBeVisible();

    await openWorkspace(page, "/dashboard/workspace?project=prj_e2e&workspace=feature-trees");
    const sourceControl = page.getByRole("complementary", { name: "Source Control" });
    await sourceControl.getByRole("button", { name: "Stage all" }).click();
    await sourceControl
      .getByRole("button", { name: "Write a commit message (choose a provider)" })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "ChatGPT plan · ada@example.com", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "ChatGPT plan · bob@example.com", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("menuitem", { name: "ChatGPT plan · ada@example.com", exact: true })
      .click();

    await expect.poll(() => generationRequests.length).toBe(1);
    expect(
      new URL(generationRequests[0]?.url ?? "https://exeora.test").searchParams.get("workspace"),
    ).toBe("wsp_feature");
    expect(generationRequests[0]?.body).toMatchObject({ provider: "chatgpt" });
    expect(projectStatusRequests.some((request) => request.workspace === "wsp_feature")).toBe(true);
  });

  for (const state of ["signed_out", "reconnect"] as const) {
    test(`keeps ChatGPT-only ${state} recovery reachable`, async ({ page }) => {
      await signedIn(page);
      await mockWorkspaceV2(page, {
        ai: true,
        aiStatus: chatgptOnlyAiStatus,
        chatgpt: { status: state === "reconnect" ? accountStatus(state) : chatgptStatus },
      });
      await openWorkspace(page, "/dashboard/settings");

      await expect(
        page
          .locator("p.text-title-md")
          .filter({ hasText: /^ChatGPT plan$/ })
          .first(),
      ).toBeVisible();
      await expect(page.getByText("OpenAI API", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible();
    });
  }

  test("uses reauthentication for a saved registration after sign-out", async ({ page }) => {
    let loginMode: string | undefined;
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: {
        status: accountStatus("signed_out"),
        login: ({ mode }) => {
          loginMode = mode;
          return loginFixture();
        },
      },
    });
    await openWorkspace(page, "/dashboard/settings");

    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await expect.poll(() => loginMode, { timeout: 5_000 }).toBe("reauth");
    await expect(page.getByRole("dialog", { name: "Continue with ChatGPT" })).toBeVisible();
  });

  test("lets the sole usable ChatGPT plan become the explicit default", async ({ page }) => {
    let saved: unknown;
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: chatgptOnlyAiStatus,
      chatgpt: { status: chatgptReadyStatus },
    });
    await page.route("**/api/ai/settings", async (route) => {
      saved = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        json: {
          ...chatgptOnlyAiStatus.settings,
          defaultProvider: "chatgpt",
        },
      });
    });
    await openWorkspace(page, "/dashboard/settings");

    const defaultProvider = page.getByRole("button", { name: /Default provider/ });
    await expect(defaultProvider).toBeVisible();
    await defaultProvider.click();
    await page.getByRole("option", { name: "ChatGPT plan", exact: true }).click();
    await page.getByRole("button", { name: "Save settings" }).click();

    await expect.poll(() => saved).toMatchObject({ defaultProvider: "chatgpt" });
    await expect(page.getByText("AI Assist settings saved.", { exact: true })).toBeVisible();
  });

  test("exposes every ready machine's ChatGPT model catalog", async ({ page }) => {
    const desktop = {
      ...laptop,
      deviceId: "dev_desktop",
      name: "Desktop",
      projects: [],
    };
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      chatgpt: {
        status: ({ deviceId }) =>
          readyStatus(false, deviceId === "dev_desktop" ? "bob@example.com" : "ada@example.com"),
        models: ({ deviceId }) =>
          deviceId === "dev_desktop"
            ? { models: [{ id: "gpt-desktop", label: "Desktop model" }] }
            : { models: [{ id: "gpt-laptop", label: "Laptop model" }] },
      },
    });
    await page.route("**/api/machines", (route) =>
      route.fulfill({ status: 200, json: { machines: [laptop, desktop] } }),
    );
    await openWorkspace(page, "/dashboard/settings");

    const provider = page.getByRole("button", { name: /Commit messages provider/ });
    await expect(provider).toBeVisible();
    await provider.click();
    await page.getByRole("option", { name: "ChatGPT plan", exact: true }).click();

    const machine = page.getByRole("button", { name: /Commit messages ChatGPT machine/ });
    await expect(machine).toBeVisible();
    await machine.click();
    await expect(page.getByRole("option", { name: "Laptop", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Desktop", exact: true })).toBeVisible();
    await page.getByRole("option", { name: "Desktop", exact: true }).click();

    const model = page.getByRole("button", { name: /Commit messages model/ });
    await model.click();
    await expect(page.getByRole("option", { name: "Desktop model", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Laptop model", exact: true })).toHaveCount(0);
    await page.getByRole("option", { name: "Desktop model", exact: true }).click();

    await machine.click();
    await page.getByRole("option", { name: "Laptop", exact: true }).click();
    await model.click();
    await expect(page.getByRole("option", { name: "Laptop model", exact: true })).toBeVisible();
  });
});
