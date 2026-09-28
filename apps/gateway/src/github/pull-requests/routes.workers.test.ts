import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, envOff } from "../fixtures.js";
import {
  audited,
  ELSEWHERE,
  github,
  LINKED,
  OTHER,
  pull,
  restoreGitHub,
  SSH_PROJECT,
  seed,
  testEnv,
  USER,
} from "./routes-fixtures.js";

/** The pull request of a branch, as the dashboard asks about it. Changing it has a file of its own. */

beforeEach(seed);
afterEach(restoreGitHub);

describe("finding the pull request of a branch", () => {
  it("answers github_disabled everywhere while the app is off", async () => {
    const off = envOff();
    for (const [path, body] of [
      [`${LINKED}?branch=feature`, undefined],
      [`${LINKED}/7/checks`, undefined],
      [LINKED, { title: "x", base: "main", head: "feature" }],
      [`${LINKED}/7/merge`, { method: "merge" }],
    ] as const) {
      const response = await call(path, { userId: USER, env: off, ...(body ? { body } : {}) });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "github_disabled" });
    }
  });

  it("finds the open pull request by head, with the repository and what the app still lacks", async () => {
    const fake = github();
    const response = await call(`${LINKED}?branch=feature`, { userId: USER, env: await testEnv() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repository: {
        owner: "octocat",
        repo: "api",
        fullName: "octocat/api",
        defaultBranch: "develop",
        mergeMethods: ["merge", "squash"],
        deleteBranchOnMerge: true,
        url: "https://github.com/octocat/api",
      },
      pullRequest: {
        number: 7,
        nodeId: "PR_node_7",
        title: "Feature 7",
        body: "Adds things",
        state: "open",
        author: { login: "octocat", avatarUrl: "https://avatars.example/1" },
        head: { ref: "feature", sha: "abc123" },
        base: { ref: "main" },
        url: "https://github.com/octocat/api/pull/7",
        mergeable: true,
        mergeableState: "clean",
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        createdAt: "2026-09-01T10:00:00Z",
        updatedAt: "2026-09-02T10:00:00Z",
        mergedAt: null,
      },
      pending: ["issues", "actions", "checks", "statuses", "workflows"],
    });
    const lookup = fake.asked.find((a) => new URL(a.url).pathname === "/repos/octocat/api/pulls");
    expect(new URL(lookup?.url ?? "").searchParams.get("head")).toBe("octocat:feature");
    expect(lookup?.headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(await audited()).toEqual([]);
  });

  it("answers null with the repository when the branch has none, and a merged one over nothing", async () => {
    github({
      pulls: [
        pull(9, {
          state: "closed",
          merged: true,
          merged_at: "2026-08-01T00:00:00Z",
          head: { ref: "done", sha: "1" },
        }),
      ],
      squash: true,
    });
    const testenv = await testEnv();
    const none = await call(`${LINKED}?branch=feature`, { userId: USER, env: testenv });
    expect(await none.json()).toMatchObject({
      repository: { fullName: "octocat/api" },
      pullRequest: null,
    });
    const merged = await call(`${LINKED}?branch=done`, { userId: USER, env: testenv });
    expect(await merged.json()).toMatchObject({
      pullRequest: { number: 9, state: "merged", mergedAt: "2026-08-01T00:00:00Z" },
    });
    const unasked = await call(LINKED, { userId: USER, env: testenv });
    expect(await unasked.json()).toMatchObject({ pullRequest: null, pending: expect.any(Array) });
  });

  it("reads the repository off an ssh remote when the project was never linked", async () => {
    github();
    const response = await call(`/api/projects/${SSH_PROJECT}/pull-request`, {
      userId: USER,
      env: await testEnv(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      repository: {
        owner: "Octocat",
        repo: "Web",
        fullName: "Octocat/Web",
        url: "https://github.com/Octocat/Web",
      },
      pending: ["issues", "actions", "checks", "statuses", "workflows"],
    });
  });

  it("says not_github for a remote elsewhere, and asks GitHub nothing", async () => {
    const fake = github();
    const response = await call(`/api/projects/${ELSEWHERE}/pull-request?branch=feature`, {
      userId: USER,
      env: await testEnv(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repository: null,
      pullRequest: null,
      pending: [],
      reason: "not_github",
    });
    expect(fake.asked).toEqual([]);
    const refused = await call(`/api/projects/${ELSEWHERE}/pull-request/7/merge`, {
      userId: USER,
      env: await testEnv(),
      body: { method: "merge" },
    });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: "not_github" });
  });

  it("asks the account to connect again when it has no token, and hides other accounts' projects", async () => {
    github();
    const testenv = await testEnv();
    const theirs = await call("/api/projects/prj_pr_routes_theirs/pull-request", {
      userId: OTHER,
      env: testenv,
    });
    expect(theirs.status).toBe(409);
    expect(await theirs.json()).toMatchObject({ error: "github_reconnect" });
    const hidden = await call(`${LINKED}?branch=feature`, { userId: OTHER, env: testenv });
    expect(hidden.status).toBe(404);
  });
});

describe("checks and conversation", () => {
  it("groups what ran against the head commit", async () => {
    github();
    const response = await call(`${LINKED}/7/checks`, { userId: USER, env: await testEnv() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sha: "abc123",
      failing: [
        {
          id: "run:1",
          name: "test",
          state: "failing",
          url: "https://ci/1",
          app: "GitHub Actions",
          startedAt: null,
          completedAt: null,
          description: "2 failed",
        },
      ],
      inProgress: [
        {
          id: "run:2",
          name: "build",
          state: "in_progress",
          url: "https://ci/2",
          app: "GitHub Actions",
          startedAt: null,
          completedAt: null,
          description: null,
        },
      ],
      successful: [
        {
          id: "status:3",
          name: "ci/circle",
          state: "successful",
          url: "https://circle/3",
          app: null,
          startedAt: null,
          completedAt: null,
          description: null,
        },
      ],
    });
  });

  it("merges comments, line comments and reviews into one thread the viewer may edit their part of", async () => {
    github();
    const response = await call(`${LINKED}/7/conversation`, { userId: USER, env: await testEnv() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      viewer: string;
      items: Array<Record<string, unknown>>;
    };
    expect(body.viewer).toBe("octocat");
    expect(body.items.map((item) => [item.id, item.kind, item.editable])).toEqual([
      ["review_comment:56", "review_comment", false],
      ["comment:55", "comment", true],
      ["review:58", "review", false],
    ]);
    expect(body.items[0]).toMatchObject({ path: "src/a.ts", line: 4, diffHunk: "@@" });
    expect(body.items[2]).toMatchObject({ reviewState: "approved", body: "LGTM" });
  });
});
