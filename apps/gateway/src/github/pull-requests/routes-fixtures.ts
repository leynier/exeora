import { env } from "cloudflare:test";
import { decodeRelayMessage, encodeMessage, PROTOCOL_VERSION } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { relayName } from "../../api/ops.js";
import { db, schema } from "../../db/client.js";
import { type Asked, authorize, envOn, fakeGitHub, tokenOf } from "../fixtures.js";
import { replaceOutbound } from "../outbound.js";

/**
 * What the pull request route tests share: an account with a linked
 * project and two more, a GitHub with one repository that answers as GitHub
 * does, and a CLI on the account's laptop that pushes when asked.
 *
 * Not a `.test.ts` file, so vitest does not collect it as a suite of its own.
 */

export const USER = "usr_pr_routes";
export const OTHER = "usr_pr_routes_other";
export const DEVICE = "dev_pr_routes";
export const PROJECT = "prj_pr_routes";
export const SSH_PROJECT = "prj_pr_routes_ssh";
export const ELSEWHERE = "prj_pr_routes_gitlab";
export const INSTALLATION = 9101;
export const LINKED = `/api/projects/${PROJECT}/pull-request`;

/** The account, its machine and its projects, as `beforeEach` seeds them. */
export async function seed(): Promise<void> {
  const database = db(env);
  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }
  // Not the users' rows, so not gone with them.
  await database.delete(schema.auditOutbox).where(eq(schema.auditOutbox.userId, USER)).run();
  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "pr-routes@example.com" },
      { id: OTHER, email: "pr-routes-other@example.com" },
    ])
    .run();
  await database
    .insert(schema.devices)
    .values([
      { id: DEVICE, userId: USER, name: "laptop", platform: "linux" },
      { id: "dev_pr_routes_other", userId: OTHER, name: "laptop", platform: "linux" },
    ])
    .run();
  const project = (id: string, userId: string, deviceId: string, repoUrl: string) => ({
    id,
    userId,
    deviceId,
    name: id,
    slug: id,
    localPath: `/w/${id}`,
    repoUrl,
  });
  await database
    .insert(schema.projects)
    .values([
      project(PROJECT, USER, DEVICE, "https://github.com/octocat/api.git"),
      project(SSH_PROJECT, USER, DEVICE, "git@github.com:Octocat/Web.git"),
      project(ELSEWHERE, USER, DEVICE, "https://gitlab.com/octocat/api.git"),
      project("prj_pr_routes_theirs", OTHER, "dev_pr_routes_other", "https://github.com/x/y.git"),
    ])
    .run();
  await database
    .insert(schema.githubInstallations)
    .values({
      id: "ghi_pr_routes",
      userId: USER,
      installationId: INSTALLATION,
      accountLogin: "octocat",
      accountType: "User",
      permissions: JSON.stringify({ contents: "write", metadata: "read", pull_requests: "write" }),
    })
    .run();
  await database
    .insert(schema.githubRepositories)
    .values({
      projectId: PROJECT,
      userId: USER,
      installationId: INSTALLATION,
      repoId: 41,
      fullName: "octocat/api",
    })
    .run();
  await authorize(USER, { login: "octocat" });
}

let restore: (() => void) | undefined;

/** Puts the real GitHub back, for `afterEach`. */
export function restoreGitHub(): void {
  restore?.();
  restore = undefined;
}

/** A gateway whose audit goes to the outbox, where a test can read it. */
export const testEnv = () => envOn({ AUDIT_STREAM: undefined });

export function pull(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    node_id: `PR_node_${number}`,
    title: `Feature ${number}`,
    body: "Adds things",
    state: "open",
    draft: false,
    merged: false,
    merged_at: null,
    user: { login: "octocat", avatar_url: "https://avatars.example/1" },
    head: { ref: "feature", sha: "abc123" },
    base: { ref: "main" },
    html_url: `https://github.com/octocat/api/pull/${number}`,
    mergeable: true,
    mergeable_state: "clean",
    additions: 10,
    deletions: 2,
    changed_files: 3,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
    ...over,
  };
}

export function comment(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    body: `Comment ${id}`,
    user: { login: "hubot", avatar_url: null },
    html_url: `https://github.com/octocat/api/pull/7#issuecomment-${id}`,
    created_at: "2026-09-03T10:00:00Z",
    updated_at: "2026-09-03T10:00:00Z",
    ...over,
  };
}

export interface Repo {
  /** The pull requests of the repository, whatever their state. */
  pulls: ReturnType<typeof pull>[];
  squash: boolean;
}

/** A GitHub with one repository in it, which answers the person and nobody else. */
export function github(repo: Repo = { pulls: [pull(7)], squash: true }) {
  const fake = fakeGitHub((asked: Asked) => {
    const url = new URL(asked.url);
    const path = url.pathname;
    if (asked.headers.get("Authorization") !== `Bearer ${tokenOf(USER)}`) {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    const one = (number: string | undefined) => repo.pulls.find((p) => p.number === Number(number));

    if (asked.method === "POST" && path === "/graphql") {
      return json({ data: { pullRequest: { isDraft: true } } });
    }
    if (path === "/repos/octocat/api" || path === "/repos/Octocat/Web") {
      return json({
        default_branch: "develop",
        allow_merge_commit: true,
        allow_squash_merge: repo.squash,
        allow_rebase_merge: false,
        delete_branch_on_merge: true,
        html_url: `https://github.com${path.replace("/repos", "")}`,
      });
    }
    if (asked.method === "GET" && path === "/repos/octocat/api/pulls") {
      const head = url.searchParams.get("head")?.split(":")[1];
      const state = url.searchParams.get("state");
      return json(
        repo.pulls.filter(
          (p) =>
            p.head.ref === head &&
            (state === "all" || p.state === state || (!state && p.state === "open")),
        ),
      );
    }
    if (asked.method === "POST" && path === "/repos/octocat/api/pulls") {
      const body = asked.body as { title: string; head: string; base: string; draft: boolean };
      const made = pull(8, {
        title: body.title,
        draft: body.draft,
        head: { ref: body.head, sha: "def456" },
        base: { ref: body.base },
      });
      repo.pulls.push(made);
      return json(made, 201);
    }
    let match = /^\/repos\/octocat\/api\/pulls\/(\d+)$/.exec(path);
    if (match) {
      const found = one(match[1]);
      if (!found) return undefined;
      if (asked.method === "PATCH") Object.assign(found, asked.body);
      return json(found);
    }
    match = /^\/repos\/octocat\/api\/pulls\/(\d+)\/merge$/.exec(path);
    if (match && asked.method === "PUT") {
      const found = one(match[1]);
      if (!found) return undefined;
      Object.assign(found, { merged: true, merged_at: "2026-09-04T10:00:00Z" });
      return json({ sha: "fed987", merged: true, message: "Pull Request successfully merged" });
    }
    match = /^\/repos\/octocat\/api\/commits\/([^/]+)\/(check-runs|status)$/.exec(path);
    if (match) {
      if (match[2] === "check-runs") {
        return json({
          check_runs: [
            {
              id: 1,
              name: "test",
              status: "completed",
              conclusion: "failure",
              html_url: "https://ci/1",
              app: { name: "GitHub Actions" },
              output: { title: "2 failed" },
            },
            {
              id: 2,
              name: "build",
              status: "in_progress",
              conclusion: null,
              details_url: "https://ci/2",
              app: { name: "GitHub Actions" },
            },
          ],
        });
      }
      return json({
        statuses: [
          { id: 3, context: "ci/circle", state: "success", target_url: "https://circle/3" },
        ],
      });
    }
    match = /^\/repos\/octocat\/api\/issues\/(\d+)\/comments$/.exec(path);
    if (match) {
      if (asked.method === "POST") {
        const { body } = asked.body as { body: string };
        return json(comment(60, { body, user: { login: "octocat", avatar_url: null } }), 201);
      }
      return json([comment(55, { user: { login: "octocat", avatar_url: null } })]);
    }
    match = /^\/repos\/octocat\/api\/pulls\/(\d+)\/comments$/.exec(path);
    if (match)
      return json([
        comment(56, {
          path: "src/a.ts",
          line: 4,
          diff_hunk: "@@",
          created_at: "2026-09-02T10:00:00Z",
        }),
      ]);
    match = /^\/repos\/octocat\/api\/pulls\/(\d+)\/reviews$/.exec(path);
    if (match) {
      return json([
        {
          id: 57,
          state: "COMMENTED",
          body: "",
          user: { login: "hubot" },
          submitted_at: "2026-09-02T10:00:01Z",
          html_url: "https://r/57",
        },
        {
          id: 58,
          state: "APPROVED",
          body: "LGTM",
          user: { login: "hubot" },
          submitted_at: "2026-09-03T12:00:00Z",
          html_url: "https://r/58",
        },
      ]);
    }
    match = /^\/repos\/octocat\/api\/(issues|pulls)\/comments\/(\d+)$/.exec(path);
    if (match && asked.method === "PATCH") {
      const { body } = asked.body as { body: string };
      return json(
        comment(Number(match[2]), {
          body,
          ...(match[1] === "pulls" ? { path: "src/a.ts", line: 4 } : {}),
        }),
      );
    }
    return undefined;
  });
  restore = replaceOutbound(fake.fetcher);
  return { ...fake, repo };
}

export const paths = (asked: Asked[]) => asked.map((a) => `${a.method} ${new URL(a.url).pathname}`);

/**
 * The audit rows the outbox holds for the account, oldest first, as the
 * tool and how it ended. Each names the project root it was done in.
 */
export async function audited(): Promise<Array<[string, string | null]>> {
  const rows = await db(env)
    .select({
      tool: schema.auditOutbox.tool,
      status: schema.auditOutbox.status,
      slug: schema.auditOutbox.workspaceSlug,
      projectId: schema.auditOutbox.projectId,
    })
    .from(schema.auditOutbox)
    .where(eq(schema.auditOutbox.userId, USER))
    .all();
  for (const row of rows) {
    if (row.projectId !== PROJECT || !row.slug) throw new Error(`stray audit row: ${row.tool}`);
  }
  return rows.map((row) => [row.tool, row.status]);
}

export async function laptop(answer: "pushed" | "refused" = "pushed") {
  const response = await env.DEVICE_RELAY.getByName(relayName(USER, DEVICE)).fetch(
    new Request(`https://relay/connect?deviceId=${DEVICE}`, { headers: { Upgrade: "websocket" } }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("the relay did not return a socket");
  socket.accept();
  const asked: unknown[] = [];
  const acknowledged = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = decodeRelayMessage(String(event.data));
      if (message?.type === "hello.ack") resolve();
      if (message?.type !== "workspace.call") return;
      asked.push(message.action);
      const status = {
        kind: "status",
        repository: true,
        head: "feature",
        oid: "def456",
        upstream: "origin/feature",
        ahead: 0,
        behind: 0,
        operation: null,
        files: [],
        branches: [],
        remotes: ["origin"],
      };
      socket.send(
        encodeMessage({
          type: "workspace.result",
          requestId: message.requestId,
          durationMs: 1,
          result:
            answer === "pushed"
              ? { ok: true, value: { kind: "mutation", stdout: "", stderr: "", status } as never }
              : {
                  ok: false,
                  error: { code: "TOOL_FAILED", message: "rejected: non-fast-forward" },
                },
        }),
      );
    });
  });
  socket.send(
    encodeMessage({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      deviceId: DEVICE,
      cliVersion: "0.18.0",
      platform: "linux",
      projects: [{ id: PROJECT, slug: PROJECT }],
      capabilities: {
        prompt: false,
        tools: ["read_file"],
        features: ["source-control-v1"],
        workspaceRouting: true,
      },
    }),
  );
  await acknowledged;
  return { socket, asked, close: () => socket.close(1000, "done") };
}
