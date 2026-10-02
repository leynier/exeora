import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { aiStatus, mockWorkspaceV2, project } from "./workspace-v2-mock.js";

test("requires replacing a retired plan preference explicitly before saving API-key settings", async ({
  page,
}) => {
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true });
  await page.route("**/api/ai", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...aiStatus,
        providers: aiStatus.providers.map((provider) =>
          provider.id === "openai"
            ? { ...provider, linked: { kind: "api_key", accountLabel: null } }
            : provider,
        ),
        settings: { ...aiStatus.settings, defaultProvider: "chatgpt" },
      },
    }),
  );
  await openWorkspace(page, "/dashboard/settings");
  const choice = page.getByRole("button", { name: /^Default provider/ });
  await expect(choice).toContainText("Previous ChatGPT plan (not linked)");
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  await choice.click();
  await page
    .getByRole("listbox", { name: "Default provider", exact: true })
    .getByRole("option", { name: "ChatGPT (API key)", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
});

test("shows an automatic default honestly when provider order differs", async ({ page }) => {
  await signedIn(page);
  await mockWorkspaceV2(page, { ai: true });
  await page.route("**/api/ai", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...aiStatus,
        providers: [...aiStatus.providers].reverse().map((provider) => ({
          ...provider,
          linked: { kind: "oauth", accountLabel: provider.id },
        })),
        settings: { ...aiStatus.settings, defaultProvider: null },
      },
    }),
  );
  await openWorkspace(page, "/dashboard/settings");
  await expect(page.getByRole("button", { name: /^Default provider/ })).toContainText(
    "Automatic (first linked account)",
  );
});

test("blocks Ship before mutations when the previous plan would use an API key", async ({
  page,
}) => {
  const mutations: string[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    ai: true,
    github: { pullRequest: null },
    onRequest: (request) => {
      if (
        request.method() === "POST" &&
        (request.url().includes("/workspace/actions") || request.url().includes("/ai/"))
      )
        mutations.push(request.url());
    },
  });
  await page.route("**/api/ai", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...aiStatus,
        providers: aiStatus.providers.map((provider) =>
          provider.id === "openai"
            ? { ...provider, linked: { kind: "api_key", accountLabel: null } }
            : provider,
        ),
        settings: { ...aiStatus.settings, defaultProvider: "chatgpt" },
      },
    }),
  );
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page
    .getByRole("complementary", { name: "Source Control" })
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Ship changes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Ship changes", exact: true })).toContainText(
    "Link the configured AI providers in Settings before shipping changes.",
  );
  expect(mutations).toEqual([]);
});

test("ships with a linked Codex account through gateway generation", async ({ page }) => {
  const generated: string[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    ai: true,
    github: { pullRequest: null },
    onRequest: (request) => {
      if (request.method() === "POST" && /\/ai\/(commit-message|pull-request)/.test(request.url()))
        generated.push(request.postDataJSON().provider);
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page
    .getByRole("complementary", { name: "Source Control" })
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Ship changes", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Ship changes", exact: true })
      .getByRole("link", { name: /Grow a tree/ }),
  ).toBeVisible();
  expect(generated).toEqual(["openai", "openai"]);
});
