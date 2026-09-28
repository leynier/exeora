import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limiterFor } from "../../rate-limit.js";
import { call } from "../fixtures.js";
import {
  audited,
  github,
  LINKED,
  laptop,
  PROJECT,
  paths,
  pull,
  restoreGitHub,
  seed,
  testEnv,
  USER,
} from "./routes-fixtures.js";

/** Changing the pull request of a branch from the dashboard: each change reaches GitHub as the person, and is audited. */

beforeEach(seed);
afterEach(restoreGitHub);

describe("changing the pull request", () => {
  it("pushes the branch first, then creates, and audits both without the title", async () => {
    const fake = github({ pulls: [], squash: true });
    const cli = await laptop();
    try {
      const response = await call(LINKED, {
        userId: USER,
        env: await testEnv(),
        body: { title: "Add feature", body: "Why", base: "main", head: "feature", draft: true },
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        pullRequest: {
          number: 8,
          title: "Add feature",
          state: "draft",
          head: { ref: "feature", sha: "def456" },
          base: { ref: "main" },
        },
      });
    } finally {
      cli.close();
    }
    expect(cli.asked).toEqual([{ action: "push", remote: "origin", setUpstream: true }]);
    const created = fake.asked.find((a) => a.method === "POST");
    expect(created?.body).toEqual({
      title: "Add feature",
      body: "Why",
      base: "main",
      head: "feature",
      draft: true,
    });
    expect(await audited()).toEqual([
      ["source_control.push", "ok"],
      ["pull_request.create", "ok"],
    ]);
  });

  it("creates nothing when the push fails, and says why", async () => {
    const fake = github({ pulls: [], squash: true });
    const cli = await laptop("refused");
    try {
      const response = await call(LINKED, {
        userId: USER,
        env: await testEnv(),
        body: { title: "Add feature", base: "main", head: "feature" },
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: "TOOL_FAILED",
        message: "rejected: non-fast-forward",
      });
    } finally {
      cli.close();
    }
    expect(fake.asked).toEqual([]);
    expect(await audited()).toEqual([["source_control.push", "error"]]);
  });

  it("creates without pushing when told the branch is already there", async () => {
    const fake = github({ pulls: [], squash: true });
    const response = await call(LINKED, {
      userId: USER,
      env: await testEnv(),
      body: { title: "Add feature", base: "main", head: "feature", push: false },
    });
    expect(response.status).toBe(201);
    expect(paths(fake.asked)).toEqual(["POST /repos/octocat/api/pulls"]);
    expect(await audited()).toEqual([["pull_request.create", "ok"]]);
  });

  it("refuses a merge method the repository does not allow, and merges with one it does", async () => {
    const fake = github({ pulls: [pull(7)], squash: false });
    const testenv = await testEnv();
    const refused = await call(`${LINKED}/7/merge`, {
      userId: USER,
      env: testenv,
      body: { method: "squash" },
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      error: "merge_method_not_allowed",
      allowed: ["merge"],
    });
    expect(await audited()).toEqual([]);

    const merged = await call(`${LINKED}/7/merge`, {
      userId: USER,
      env: testenv,
      body: { method: "merge" },
    });
    expect(merged.status).toBe(200);
    expect(await merged.json()).toEqual({
      merged: true,
      sha: "fed987",
      message: "Pull Request successfully merged",
    });
    const put = fake.asked.find((a) => a.method === "PUT");
    expect(put?.body).toEqual({ merge_method: "merge" });
    expect(await audited()).toEqual([["pull_request.merge", "ok"]]);
  });

  it("changes the title through REST and the draft state through GraphQL", async () => {
    const fake = github();
    const testenv = await testEnv();
    const retitled = await call(`${LINKED}/7`, {
      method: "PATCH",
      userId: USER,
      env: testenv,
      body: { title: "Better", draft: true },
    });
    expect(retitled.status).toBe(200);
    expect(await retitled.json()).toMatchObject({ pullRequest: { title: "Better" } });
    const patched = fake.asked.find((a) => a.method === "PATCH");
    expect(patched?.body).toEqual({ title: "Better" });
    const mutation = fake.asked.find((a) => new URL(a.url).pathname === "/graphql");
    expect(mutation?.body).toEqual({
      query: expect.stringContaining("convertPullRequestToDraft"),
      variables: { id: "PR_node_7" },
    });

    fake.asked.length = 0;
    for (const p of fake.repo.pulls) p.draft = true;
    const ready = await call(`${LINKED}/7`, {
      method: "PATCH",
      userId: USER,
      env: testenv,
      body: { draft: false },
    });
    expect(ready.status).toBe(200);
    expect(paths(fake.asked)).toEqual([
      "GET /repos/octocat/api/pulls/7",
      "POST /graphql",
      "GET /repos/octocat/api/pulls/7",
    ]);
    expect(fake.asked[1]?.body).toMatchObject({
      query: expect.stringContaining("markPullRequestReadyForReview"),
    });

    fake.asked.length = 0;
    const same = await call(`${LINKED}/7`, {
      method: "PATCH",
      userId: USER,
      env: testenv,
      body: { draft: true },
    });
    expect(same.status).toBe(200);
    expect(paths(fake.asked)).toEqual(["GET /repos/octocat/api/pulls/7"]);
    expect(await audited()).toEqual([
      ["pull_request.update", "ok"],
      ["pull_request.update", "ok"],
      ["pull_request.update", "ok"],
    ]);
  });

  it("closes, and records the closing", async () => {
    const fake = github();
    const response = await call(`${LINKED}/7/close`, {
      method: "POST",
      userId: USER,
      env: await testEnv(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pullRequest: { number: 7, state: "closed" } });
    expect(fake.asked.find((a) => a.method === "PATCH")?.body).toEqual({ state: "closed" });
    expect(await audited()).toEqual([["pull_request.close", "ok"]]);
  });

  it("comments, and edits a comment at the endpoint of its kind", async () => {
    const fake = github();
    const testenv = await testEnv();
    const posted = await call(`${LINKED}/7/comments`, {
      userId: USER,
      env: testenv,
      body: { body: "Thanks" },
    });
    expect(posted.status).toBe(201);
    expect(await posted.json()).toEqual({
      item: expect.objectContaining({
        id: "comment:60",
        kind: "comment",
        githubId: 60,
        body: "Thanks",
        editable: true,
      }),
    });

    const plain = await call(`${LINKED}/7/comments/55`, {
      method: "PATCH",
      userId: USER,
      env: testenv,
      body: { body: "Edited", kind: "comment" },
    });
    expect(plain.status).toBe(200);
    expect(await plain.json()).toMatchObject({
      item: { id: "comment:55", body: "Edited", editable: true },
    });
    const inline = await call(`${LINKED}/7/comments/56`, {
      method: "PATCH",
      userId: USER,
      env: testenv,
      body: { body: "Edited too", kind: "review_comment" },
    });
    expect(inline.status).toBe(200);
    expect(await inline.json()).toMatchObject({
      item: {
        id: "review_comment:56",
        kind: "review_comment",
        path: "src/a.ts",
        line: 4,
        editable: true,
      },
    });
    expect(paths(fake.asked)).toEqual([
      "POST /repos/octocat/api/issues/7/comments",
      "PATCH /repos/octocat/api/issues/comments/55",
      "PATCH /repos/octocat/api/pulls/comments/56",
    ]);
    expect(await audited()).toEqual([
      ["pull_request.comment", "ok"],
      ["pull_request.comment_edit", "ok"],
      ["pull_request.comment_edit", "ok"],
    ]);

    const empty = await call(`${LINKED}/7/comments`, {
      userId: USER,
      env: testenv,
      body: { body: "" },
    });
    expect(empty.status).toBe(400);
  });

  it("counts changes on the write limiter and reads on none", () => {
    const bindings = { RL_MCP: "mcp", RL_WRITE: "write" } as unknown as Pick<
      Env,
      "RL_MCP" | "RL_WRITE"
    >;
    expect(limiterFor(bindings, "GET", `${LINKED}?branch=x`.split("?")[0] ?? "")).toBeUndefined();
    expect(limiterFor(bindings, "GET", `${LINKED}/7/checks`)).toBeUndefined();
    expect(limiterFor(bindings, "POST", LINKED)).toBe("write");
    expect(limiterFor(bindings, "PATCH", `${LINKED}/7`)).toBe("write");
    expect(limiterFor(bindings, "POST", `${LINKED}/7/merge`)).toBe("write");
    expect(limiterFor(bindings, "PATCH", `${LINKED}/7/comments/55`)).toBe("write");
    expect(limiterFor(bindings, "POST", `/api/projects/${PROJECT}/pull-requests`)).toBeUndefined();
  });
});
