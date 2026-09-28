import type { Page, Request, Route } from "@playwright/test";
import { github } from "./fixtures.js";

/**
 * What the gateway answers about GitHub, the pull request of a branch and
 * AI Assist, for the specs that exercise those views. Layered over the
 * workspace mock the same way that one is layered over the API mock.
 */

export const pullRequest = {
  number: 42,
  nodeId: "PR_node42",
  title: "Grow a tree",
  body: "Trees are **good**.",
  state: "open",
  author: { login: "ada", avatarUrl: null },
  head: { ref: "feature/trees", sha: "f1f1f1f1f1f1" },
  base: { ref: "main" },
  url: "https://github.com/example/e2e/pull/42",
  mergeable: true,
  mergeableState: "clean",
  additions: 13,
  deletions: 1,
  changedFiles: 2,
  createdAt: new Date(Date.now() - 86400_000).toISOString(),
  updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  mergedAt: null,
};

export const repository = {
  owner: "example",
  repo: "e2e",
  fullName: "example/e2e",
  defaultBranch: "main",
  mergeMethods: ["squash", "merge"],
  deleteBranchOnMerge: true,
  url: "https://github.com/example/e2e",
};

export const aiStatus = {
  enabled: true,
  providers: [
    {
      id: "openai",
      label: "ChatGPT",
      authKinds: ["oauth", "api_key"],
      linked: { kind: "oauth", accountLabel: "ada@example.com" },
      models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
    },
    {
      id: "xai",
      label: "Grok",
      authKinds: ["oauth", "api_key"],
      linked: null,
      models: [{ id: "grok-4-fast", label: "Grok 4 Fast" }],
    },
  ],
  settings: {
    defaultProvider: "openai",
    operations: {
      commit: { provider: null, model: null, instructions: null },
      pull_request: { provider: null, model: null, instructions: null },
    },
  },
  oauthAvailable: true,
};

export type PullRequestFixture = typeof pullRequest;

export async function mockIntegrations(
  page: Page,
  options: {
    onRequest?: (request: Request) => void;
    github?: { pullRequest: PullRequestFixture | null };
    ai?: boolean;
  },
) {
  const integrations = async (route: Route) => {
    const request = route.request();
    options.onRequest?.(request);
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/github") {
      await route.fulfill({
        status: 200,
        json: options.github ? github : { ...github, connected: false, installations: [] },
      });
      return;
    }
    if (path === "/api/ai") {
      await route.fulfill({
        status: 200,
        json: options.ai
          ? aiStatus
          : { enabled: false, providers: [], settings: null, oauthAvailable: false },
      });
      return;
    }
    if (path.endsWith("/ai/commit-message")) {
      await route.fulfill({
        status: 200,
        json: {
          message: "Grow a tree\n\nBecause shade.",
          provider: "openai",
          model: "gpt-5.5",
        },
      });
      return;
    }
    if (path.endsWith("/ai/pull-request")) {
      await route.fulfill({
        status: 200,
        json: {
          title: "Grow a tree",
          body: "Trees are good.",
          provider: "openai",
          model: "gpt-5.5",
        },
      });
      return;
    }
    if (path.startsWith("/api/ai/")) {
      await route.fulfill({
        status: 200,
        json: { status: "pending", models: [], ok: true, ...aiStatus.settings },
      });
      return;
    }
    if (/\/pull-request$/.test(path) && request.method() === "GET") {
      const branch = url.searchParams.get("branch");
      const found =
        options.github && branch === "feature/trees" ? options.github.pullRequest : null;
      await route.fulfill({
        status: 200,
        json: { repository, pullRequest: found, pending: [] },
      });
      return;
    }
    if (/\/pull-request$/.test(path) && request.method() === "POST") {
      const body = request.postDataJSON() as { title: string; draft?: boolean };
      await route.fulfill({
        status: 201,
        json: {
          pullRequest: {
            ...pullRequest,
            number: 43,
            title: body.title,
            state: body.draft ? "draft" : "open",
          },
        },
      });
      return;
    }
    if (path.endsWith("/checks")) {
      await route.fulfill({
        status: 200,
        json: {
          sha: "f1f1f1f1f1f1",
          failing: [
            {
              id: "run:1",
              name: "lint",
              state: "failing",
              url: "https://github.com/example/e2e/runs/1",
              app: "GitHub Actions",
              startedAt: null,
              completedAt: null,
              description: null,
            },
          ],
          inProgress: [],
          successful: [
            {
              id: "run:2",
              name: "test",
              state: "successful",
              url: null,
              app: "GitHub Actions",
              startedAt: null,
              completedAt: null,
              description: null,
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/conversation")) {
      await route.fulfill({
        status: 200,
        json: {
          viewer: "ada",
          items: [
            {
              id: "comment:1",
              kind: "comment",
              githubId: 1,
              author: { login: "bob", avatarUrl: null },
              body: "Looks *fine*.",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              url: "https://github.com/x",
              editable: false,
            },
            {
              id: "review:2",
              kind: "review",
              githubId: 2,
              author: { login: "ada", avatarUrl: null },
              body: "",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              url: "https://github.com/y",
              reviewState: "approved",
              editable: false,
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/merge")) {
      await route.fulfill({
        status: 200,
        json: { merged: true, sha: "abc", message: "Pull Request successfully merged" },
      });
      return;
    }
    if (path.endsWith("/comments")) {
      const body = request.postDataJSON() as { body: string };
      await route.fulfill({
        status: 201,
        json: {
          item: {
            id: "comment:9",
            kind: "comment",
            githubId: 9,
            author: { login: "ada", avatarUrl: null },
            body: body.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            url: "https://github.com/z",
            editable: true,
          },
        },
      });
      return;
    }
    if (/\/pull-request\/\d+$/.test(path) || path.endsWith("/close")) {
      await route.fulfill({
        status: 200,
        json: {
          pullRequest: { ...pullRequest, state: path.endsWith("/close") ? "closed" : "draft" },
        },
      });
      return;
    }
    await route.fallback();
  };
  // One handler, several patterns: Playwright's globs take no alternation.
  for (const pattern of [
    "**/api/github",
    "**/api/ai",
    "**/api/ai/**",
    "**/api/projects/*/pull-request**",
    "**/api/projects/*/ai/**",
  ]) {
    await page.route(pattern, integrations);
  }
}
