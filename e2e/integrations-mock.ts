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

import {
  type AiStatusFixture,
  aiStatus,
  type ChatgptMock,
  chatgptLogin,
  chatgptStatus,
} from "./chatgpt-mock.js";

export {
  type AiStatusFixture,
  aiStatus,
  type ChatgptLoginFixture,
  type ChatgptMock,
  type ChatgptModelsContext,
  type ChatgptModelsFixture,
  type ChatgptProjectStatusContext,
  type ChatgptStatusFixture,
  chatgptLogin,
  chatgptOnlyAiStatus,
  chatgptReadyStatus,
  chatgptStatus,
} from "./chatgpt-mock.js";

export type PullRequestFixture = typeof pullRequest;

export async function mockIntegrations(
  page: Page,
  options: {
    onRequest?: (request: Request) => void;
    github?: { pullRequest: PullRequestFixture | null };
    ai?: boolean;
    aiStatus?: AiStatusFixture;
    chatgpt?: ChatgptMock;
  },
) {
  const chatgptStatusRequests = new Map<string, number>();
  const chatgptProjectStatusRequests = new Map<string, number>();
  const chatgptLoginModes = new Map<string, string>();
  const chatgptLoginRequests = new Map<string, number>();
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
          ? (options.aiStatus ?? aiStatus)
          : { enabled: false, providers: [], settings: null, oauthAvailable: false },
      });
      return;
    }
    const projectChatgpt = path.match(/^\/api\/projects\/([^/]+)\/ai\/chatgpt(?:\/(.*))?$/);
    if (projectChatgpt) {
      const projectId = decodeURIComponent(projectChatgpt[1] ?? "");
      const action = projectChatgpt[2] ?? "status";
      const workspace = url.searchParams.get("workspace") ?? undefined;
      if (action === "status" && request.method() === "GET") {
        if (!options.chatgpt) return route.fallback();
        const key = `${projectId}:${workspace ?? ""}`;
        const requestNumber = (chatgptProjectStatusRequests.get(key) ?? 0) + 1;
        chatgptProjectStatusRequests.set(key, requestNumber);
        const configured = options.chatgpt.projectStatus;
        if (typeof configured === "function") {
          await route.fulfill({
            status: 200,
            json: configured({ projectId, workspace, requestNumber }),
          });
          return;
        }
        if (configured) {
          await route.fulfill({ status: 200, json: configured });
          return;
        }
        if (typeof options.chatgpt.status === "function") {
          await route.fulfill({
            status: 200,
            json: options.chatgpt.status({
              deviceId: "project",
              requestNumber,
              loginMode: undefined,
            }),
          });
          return;
        }
        await route.fulfill({ status: 200, json: options.chatgpt.status ?? chatgptStatus });
        return;
      }
      if (action === "models" && request.method() === "GET") {
        const configured = options.chatgpt.models;
        const value =
          typeof configured === "function"
            ? configured({ deviceId: `project:${projectId}`, requestNumber: 1 })
            : (configured ?? { models: [{ id: "gpt-5.5", label: "GPT-5.5" }] });
        await route.fulfill({ status: 200, json: value });
        return;
      }
    }
    const deviceChatgpt = path.match(/^\/api\/devices\/([^/]+)\/ai\/chatgpt(?:\/(.*))?$/);
    if (deviceChatgpt) {
      const deviceId = decodeURIComponent(deviceChatgpt[1] ?? "");
      const action = deviceChatgpt[2] ?? "status";
      if (action === "status" && request.method() === "GET") {
        const requestNumber = (chatgptStatusRequests.get(deviceId) ?? 0) + 1;
        chatgptStatusRequests.set(deviceId, requestNumber);
        const status = options.chatgpt?.status;
        const value =
          typeof status === "function"
            ? status({
                deviceId,
                requestNumber,
                loginMode: chatgptLoginModes.get(deviceId),
              })
            : (status ?? chatgptStatus);
        await route.fulfill({ status: 200, json: value });
        return;
      }
      if (action === "login" && request.method() === "POST") {
        const body = request.postDataJSON() as { mode?: string };
        const mode = body.mode ?? "new";
        chatgptLoginModes.set(deviceId, mode);
        const requestNumber = (chatgptLoginRequests.get(deviceId) ?? 0) + 1;
        chatgptLoginRequests.set(deviceId, requestNumber);
        const login = options.chatgpt?.login;
        const value =
          typeof login === "function"
            ? login({ deviceId, mode, requestNumber })
            : (login ?? chatgptLogin);
        await route.fulfill({ status: 200, json: value });
        return;
      }
      if (action === "login/cancel" && request.method() === "POST") {
        await route.fulfill({ status: 200, json: { state: "signed_out" } });
        return;
      }
      if (action === "logout" && request.method() === "POST") {
        await route.fulfill({
          status: 200,
          json: options.chatgpt?.logout ?? { revocationConfirmed: true },
        });
        return;
      }
      if (action === "models" && request.method() === "GET") {
        const requestNumber = (chatgptStatusRequests.get(`models:${deviceId}`) ?? 0) + 1;
        chatgptStatusRequests.set(`models:${deviceId}`, requestNumber);
        const configured = options.chatgpt?.models;
        const value =
          typeof configured === "function"
            ? configured({ deviceId, requestNumber })
            : (configured ?? { models: [{ id: "gpt-5.5", label: "GPT-5.5" }] });
        await route.fulfill({
          status: 200,
          json: value,
        });
        return;
      }
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
    "**/api/devices/**",
    "**/api/projects/*/pull-request**",
    "**/api/projects/*/ai/**",
  ]) {
    await page.route(pattern, integrations);
  }
}
