import type { Page, Request, Route } from "@playwright/test";
import { gitStatus, mockApi, project, workspace } from "./dashboard-mock.js";
import {
  type AiStatusFixture,
  type ChatgptMock,
  mockIntegrations,
  type PullRequestFixture,
} from "./integrations-mock.js";

/**
 * What a machine with a v2 CLI answers: the reads route, the file edits,
 * and capabilities that say so. Layered over `mockApi`, which keeps
 * answering everything else; Playwright asks the newest route first.
 */

export const commits = [
  {
    oid: "c3c3c3c3c3c3",
    shortOid: "c3c3c3c",
    parents: ["c2c2c2c2c2c2", "f1f1f1f1f1f1"],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authoredAt: new Date(Date.now() - 3600_000).toISOString(),
    committedAt: new Date(Date.now() - 3600_000).toISOString(),
    subject: "Merge branch 'feature/trees'",
    refs: ["HEAD -> main", "origin/main"],
  },
  {
    oid: "f1f1f1f1f1f1",
    shortOid: "f1f1f1f",
    parents: ["c1c1c1c1c1c1"],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authoredAt: new Date(Date.now() - 7200_000).toISOString(),
    committedAt: new Date(Date.now() - 7200_000).toISOString(),
    subject: "Grow a tree",
    refs: ["feature/trees"],
  },
  {
    oid: "c2c2c2c2c2c2",
    shortOid: "c2c2c2c",
    parents: ["c1c1c1c1c1c1"],
    authorName: "Bob",
    authorEmail: "bob@example.com",
    authoredAt: new Date(Date.now() - 86400_000).toISOString(),
    committedAt: new Date(Date.now() - 86400_000).toISOString(),
    subject: "Write the notes",
    refs: [],
  },
  {
    oid: "c1c1c1c1c1c1",
    shortOid: "c1c1c1c",
    parents: [],
    authorName: "Bob",
    authorEmail: "bob@example.com",
    authoredAt: new Date(Date.now() - 172800_000).toISOString(),
    committedAt: new Date(Date.now() - 172800_000).toISOString(),
    subject: "Initial commit",
    refs: ["tag: v0.1"],
  },
];

const patchOf = (file: string) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new`;

export const tree: Record<
  string,
  { name: string; path: string; type: string; ignored: boolean }[]
> = {
  ".": [
    { name: "src", path: "src", type: "directory", ignored: false },
    { name: "node_modules", path: "node_modules", type: "directory", ignored: true },
    { name: "main.txt", path: "main.txt", type: "file", ignored: false },
    { name: "readme.md", path: "readme.md", type: "file", ignored: false },
  ],
  src: [
    { name: "main.ts", path: "src/main.ts", type: "file", ignored: false },
    { name: "util.ts", path: "src/util.ts", type: "file", ignored: false },
  ],
};

export const files: Record<string, string> = {
  "src/main.ts": 'export const answer = 42;\nconsole.log("hello");\n',
  "src/util.ts": "export function twice(n: number) {\n  return n * 2;\n}\n",
  "main.txt": "new\n",
  "readme.md": "# E2E\n\nA project for the specs.\n",
};

export async function mockWorkspaceV2(
  page: Page,
  options: {
    onRequest?: (request: Request) => void;
    stashes?: number;
    /** GitHub connected, with this pull request for the feature branch (or none). */
    github?: { pullRequest: PullRequestFixture | null };
    /** AI Assist on, with OpenAI API and the local ChatGPT plan offered. */
    ai?: boolean;
    /** Optional provider/settings payload for provider-isolation scenarios. */
    aiStatus?: AiStatusFixture;
    /** Optional stateful responses for the local ChatGPT browser flow. */
    chatgpt?: ChatgptMock;
  } = {},
) {
  await mockApi(page, { onRequest: options.onRequest });
  let token = 1;
  if (options.github || options.ai || options.chatgpt) {
    await mockIntegrations(page, {
      ...options,
      chatgpt: options.chatgpt,
    });
  }
  await page.route("**/api/projects/*/workspace/**", async (route: Route) => {
    const request = route.request();
    options.onRequest?.(request);
    const url = new URL(request.url());
    const path = url.pathname;
    const asked = url.searchParams.get("workspace");
    const target = asked === workspace.id ? "workspace" : "main";
    if (path.endsWith("/workspace/capabilities")) {
      await route.fulfill({
        status: 200,
        json: {
          online: true,
          sourceControl: true,
          sourceControlV2: true,
          files: true,
          search: true,
          terminal: true,
          workspaceRouting: true,
        },
      });
      return;
    }
    if (path.endsWith("/workspace/status")) {
      await route.fulfill({
        status: 200,
        json: { ...gitStatus(target), stashes: options.stashes ?? 1 },
      });
      return;
    }
    if (path.endsWith("/workspace/reads")) {
      const body = request.postDataJSON() as Record<string, string | number | boolean | undefined>;
      await route.fulfill({ status: 200, json: readValue(body, token) });
      return;
    }
    if (path.endsWith("/workspace/actions")) {
      const body = request.postDataJSON() as {
        action: string;
        content?: string;
        expectedToken?: string;
      };
      if (body.action === "file_write") {
        const conflict = body.expectedToken !== undefined && body.content?.includes("CONFLICT");
        if (!conflict) token += 1;
        await route.fulfill({
          status: 200,
          json: {
            kind: "file_write",
            path: "src/main.ts",
            status: conflict ? "conflict" : "written",
            token: `tok${token}`,
          },
        });
        return;
      }
      if (body.action === "replace") {
        const targets = (body as { targets?: { path: string }[] }).targets ?? [];
        await route.fulfill({
          status: 200,
          json: {
            kind: "replace",
            files: targets.map((t) => ({ path: t.path, replaced: 1, status: "ok" })),
            replaced: targets.length,
            skipped: 0,
          },
        });
        return;
      }
      if (
        body.action.startsWith("file_") ||
        body.action.startsWith("stash") ||
        body.action === "sync"
      ) {
        await route.fulfill({
          status: 200,
          json: {
            kind: "mutation",
            stdout: "",
            stderr: "",
            status: { ...gitStatus(target), stashes: options.stashes ?? 1 },
          },
        });
        return;
      }
    }
    await route.fallback();
  });
}

function readValue(body: Record<string, unknown>, token: number): unknown {
  switch (body.action) {
    case "log":
      return { kind: "log", commits, nextCursor: null, head: "main", upstream: "origin/main" };
    case "commit_detail":
      return {
        kind: "commit_detail",
        oid: body.oid,
        message: `${commits.find((c) => c.oid === body.oid)?.subject ?? "?"}\n\nBecause trees.`,
        files: [
          { path: "src/main.ts", status: "M", additions: 3, deletions: 1, binary: false },
          { path: "docs/tree.md", status: "A", additions: 10, deletions: 0, binary: false },
        ],
      };
    case "commit_diff":
      return {
        kind: "commit_diff",
        oid: body.oid,
        path: body.path ?? null,
        patch: patchOf(typeof body.path === "string" ? body.path : "src/main.ts"),
        binary: false,
        truncated: false,
      };
    case "diff_all":
      return {
        kind: "diff_all",
        area: body.area,
        patch: `${patchOf("main.txt")}\n${patchOf("notes.md")}`,
        truncated: false,
        untrackedOmitted: false,
      };
    case "stash_list":
      return {
        kind: "stash_list",
        entries: [
          { index: 0, message: "WIP on main: try the thing", createdAt: new Date().toISOString() },
        ],
      };
    case "tree":
      return {
        kind: "tree",
        path: body.path,
        entries: (tree[String(body.path)] ?? []).filter((e) => body.showIgnored || !e.ignored),
        truncated: false,
      };
    case "file_read":
      return {
        kind: "file",
        path: body.path,
        content: files[String(body.path)] ?? "",
        encoding: "text",
        token: `tok${token}`,
        size: (files[String(body.path)] ?? "").length,
        truncated: false,
        binary: false,
        mime: null,
      };
    case "search":
      return {
        kind: "search",
        files: [
          {
            path: "src/main.ts",
            token: "tok1",
            matches: [
              {
                line: 1,
                column: 14,
                length: 6,
                preview: "export const answer = 42;",
                previewOffset: 13,
              },
            ],
            truncated: false,
          },
          {
            path: "readme.md",
            token: "tok2",
            matches: [
              {
                line: 3,
                column: 3,
                length: 7,
                preview: "A project for the specs.",
                previewOffset: 2,
              },
            ],
            truncated: false,
          },
        ],
        totalMatches: 2,
        truncated: false,
        filesSearched: 4,
        filesSkipped: 0,
      };
    default:
      return { error: "unknown" };
  }
}

export { aiStatus, pullRequest, repository } from "./integrations-mock.js";
export { project, workspace };
