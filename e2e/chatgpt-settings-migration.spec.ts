import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import {
  type AiStatusFixture,
  aiStatus,
  chatgptOnlyAiStatus,
  chatgptReadyStatus,
} from "./integrations-mock.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

test("lets a legacy account migrate both operation overrides to the local ChatGPT plan", async ({
  page,
}) => {
  const legacy: AiStatusFixture = {
    ...chatgptOnlyAiStatus,
    providers: [
      {
        id: "openai",
        label: "OpenAI API",
        authKinds: ["api_key"],
        linked: { kind: "oauth", accountLabel: "ada@example.com", legacy: true },
        models: [],
      },
      ...chatgptOnlyAiStatus.providers,
    ],
    settings: {
      defaultProvider: "openai",
      operations: {
        commit: { provider: "openai", model: "old-model", instructions: "Use Spanish." },
        pull_request: { provider: "openai", model: "old-model", instructions: null },
      },
    },
  };
  let saved: unknown;
  await signedIn(page);
  await mockWorkspaceV2(page, {
    ai: true,
    aiStatus: legacy,
    chatgpt: { status: chatgptReadyStatus },
  });
  await page.route("**/api/ai/settings", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: saved });
  });
  await openWorkspace(page, "/dashboard/settings");
  await page.getByRole("button", { name: /Default provider/ }).click();
  await page
    .getByRole("listbox", { name: "Default provider", exact: true })
    .getByRole("option", { name: "ChatGPT plan", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /Commit messages provider/ })).toContainText(
    "OpenAI API (not linked)",
  );
  await page.getByRole("button", { name: /Commit messages provider/ }).click();
  await page
    .getByRole("listbox", { name: "Commit messages provider", exact: true })
    .getByRole("option", { name: "Default provider", exact: true })
    .click();
  await page.getByRole("button", { name: /Pull requests provider/ }).click();
  await page
    .getByRole("listbox", { name: "Pull requests provider", exact: true })
    .getByRole("option", { name: "ChatGPT plan", exact: true })
    .click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect
    .poll(() => saved)
    .toEqual({
      defaultProvider: "chatgpt",
      operations: {
        commit: { provider: null, model: null, instructions: "Use Spanish." },
        pull_request: { provider: "chatgpt", model: null, instructions: null },
      },
    });
  await expect(page.getByText("AI Assist settings saved.", { exact: true })).toBeVisible();
});

for (const mixed of [false, true]) {
  test(`ships with ${mixed ? "separate operation providers" : "local ChatGPT and no saved default"}`, async ({
    page,
  }) => {
    const generated: { path: string; provider: unknown }[] = [];
    const status: AiStatusFixture = {
      ...chatgptOnlyAiStatus,
      providers: aiStatus.providers.map((provider) => ({
        ...provider,
        linked: mixed && provider.id === "xai" ? { kind: "api_key", accountLabel: "Grok" } : null,
      })) as AiStatusFixture["providers"],
      settings: {
        defaultProvider: null,
        operations: {
          commit: { provider: mixed ? "chatgpt" : null, model: null, instructions: null },
          pull_request: { provider: mixed ? "xai" : null, model: null, instructions: null },
        },
      },
    };
    await signedIn(page);
    await mockWorkspaceV2(page, {
      ai: true,
      aiStatus: status,
      github: { pullRequest: null },
      chatgpt: { status: chatgptReadyStatus, projectStatus: chatgptReadyStatus },
      onRequest: (request) => {
        if (
          request.method() === "POST" &&
          /\/ai\/(commit-message|pull-request)$/.test(request.url())
        ) {
          generated.push({
            path: new URL(request.url()).pathname,
            provider: request.postDataJSON().provider,
          });
        }
      },
    });
    await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
    const list = page.getByRole("complementary", { name: "Source Control" });
    await list.getByRole("button", { name: "More actions" }).click();
    const ship = page.getByRole("menuitem", { name: "Ship changes", exact: true });
    await expect(ship).toBeEnabled();
    await ship.click();
    const dialog = page.getByRole("dialog", { name: "Ship changes", exact: true });
    await expect(dialog.getByRole("link", { name: "#43 Grow a tree", exact: true })).toBeVisible();
    expect(generated).toEqual([
      { path: `/api/projects/${project.id}/ai/commit-message`, provider: "chatgpt" },
      { path: `/api/projects/${project.id}/ai/pull-request`, provider: mixed ? "xai" : "chatgpt" },
    ]);
  });
}

test("keeps shipping disabled when its saved provider is disconnected despite a ready ChatGPT account", async ({
  page,
}) => {
  let mutations = 0;
  await signedIn(page);
  await mockWorkspaceV2(page, {
    ai: true,
    aiStatus: {
      ...chatgptOnlyAiStatus,
      providers: aiStatus.providers.map((provider) => ({
        ...provider,
        linked: null,
      })) as AiStatusFixture["providers"],
      settings: { ...chatgptOnlyAiStatus.settings, defaultProvider: "openai" },
    },
    github: { pullRequest: null },
    chatgpt: { status: chatgptReadyStatus, projectStatus: chatgptReadyStatus },
    onRequest: (request) => {
      if (request.method() === "POST" && request.url().includes("/workspace/actions"))
        mutations += 1;
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page
    .getByRole("complementary", { name: "Source Control" })
    .getByRole("button", { name: "More actions" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Ship changes", exact: true })).toBeDisabled();
  expect(mutations).toBe(0);
});
