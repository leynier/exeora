import { describe, expect, it } from "vitest";
import { PROJECT_CLONE_FEATURE } from "./repository.js";
import { WorkspaceAction, WorkspaceValue } from "./workspace.js";
import {
  CHATGPT_V1,
  isWorkspaceRead,
  requiredFeature,
  SOURCE_CONTROL_V1,
  SOURCE_CONTROL_V2,
  WORKSPACE_ACTION_FEATURES,
  WORKSPACE_READ_ACTIONS,
  WORKSPACE_V2,
  WorkspaceReadAction,
  workspaceTab,
} from "./workspace-features.js";

describe("workspace features", () => {
  it("maps every action to a feature", () => {
    const actions = WorkspaceAction.options.map((option) => option.shape.action.value);
    expect(actions.length).toBeGreaterThan(30);
    for (const action of actions) {
      expect(WORKSPACE_ACTION_FEATURES[action], action).toMatch(/^[a-z-]+-v\d+$/);
    }
    expect(Object.keys(WORKSPACE_ACTION_FEATURES).sort()).toEqual([...actions].sort());
  });

  it("keeps v1 on its feature and puts the new work on the new ones", () => {
    expect(requiredFeature("status")).toBe(SOURCE_CONTROL_V1);
    expect(requiredFeature("commit")).toBe(SOURCE_CONTROL_V1);
    expect(requiredFeature("workspace_create")).toBe(SOURCE_CONTROL_V1);
    expect(requiredFeature("project_prepare")).toBe(PROJECT_CLONE_FEATURE);
    expect(requiredFeature("log")).toBe(SOURCE_CONTROL_V2);
    expect(requiredFeature("stash_pop")).toBe(SOURCE_CONTROL_V2);
    expect(requiredFeature("tree")).toBe(WORKSPACE_V2);
    expect(requiredFeature("replace")).toBe(WORKSPACE_V2);
    expect(requiredFeature("chatgpt_status")).toBe(CHATGPT_V1);
    expect(requiredFeature("chatgpt_generate")).toBe(CHATGPT_V1);
  });

  it("names the tab each action belongs to", () => {
    expect(workspaceTab("log")).toBe("Source Control");
    expect(workspaceTab("file_write")).toBe("Explorer");
    expect(workspaceTab("search")).toBe("Search");
    expect(workspaceTab("chatgpt_models")).toBe("ChatGPT");
  });

  it("tells reads from mutations", () => {
    const reads = WorkspaceReadAction.options.map((option) => option.shape.action.value);
    expect([...reads].sort()).toEqual(
      [
        "status",
        "diff",
        "log",
        "commit_detail",
        "commit_diff",
        "diff_all",
        "range_diff",
        "staged_context",
        "range_context",
        "stash_list",
        "tree",
        "file_read",
        "search",
      ].sort(),
    );
    expect([...WORKSPACE_READ_ACTIONS].sort()).toEqual([...reads].sort());
    expect(isWorkspaceRead("search")).toBe(true);
    expect(isWorkspaceRead("replace")).toBe(false);
    expect(isWorkspaceRead("unpublished")).toBe(false);
    expect(isWorkspaceRead("chatgpt_status")).toBe(false);
    for (const read of reads)
      expect(WorkspaceAction.options.map((o) => o.shape.action.value)).toContain(read);
  });

  it("parses sample actions with their defaults", () => {
    expect(WorkspaceReadAction.parse({ action: "log" })).toEqual({ action: "log", limit: 30 });
    expect(WorkspaceReadAction.parse({ action: "tree" })).toEqual({
      action: "tree",
      path: ".",
      showIgnored: false,
    });
    expect(WorkspaceReadAction.parse({ action: "search", query: "todo" })).toMatchObject({
      regex: false,
      caseSensitive: false,
      wholeWord: false,
      includeIgnored: false,
      maxResults: 500,
      maxPerFile: 50,
    });
    expect(WorkspaceAction.parse({ action: "stash_push" })).toEqual({
      action: "stash_push",
      includeUntracked: true,
    });
    expect(WorkspaceAction.parse({ action: "file_write", path: "a.txt", content: "x" })).toEqual({
      action: "file_write",
      path: "a.txt",
      content: "x",
      create: true,
    });
    expect(
      WorkspaceAction.parse({
        action: "replace",
        query: "a",
        replacement: "b",
        targets: [{ path: "a.txt", token: "0".repeat(64), lines: [1] }],
      }),
    ).toMatchObject({ preserveCase: false, targets: [{ lines: [1] }] });
    // A commit is named by its hash: a ref could start with a dash and read as an option.
    expect(
      WorkspaceReadAction.safeParse({ action: "commit_detail", oid: "--output=x" }).success,
    ).toBe(false);
    expect(WorkspaceReadAction.safeParse({ action: "replace" }).success).toBe(false);
    expect(
      WorkspaceAction.parse({
        action: "chatgpt_login_start",
        mode: "enable_plan",
      }),
    ).toEqual({ action: "chatgpt_login_start", mode: "enable_plan" });
    expect(
      WorkspaceAction.parse({
        action: "chatgpt_generate",
        instructions: "Write a concise commit message.",
        input: "Staged patch",
      }),
    ).toMatchObject({ action: "chatgpt_generate", input: "Staged patch" });
    expect(
      WorkspaceAction.safeParse({
        action: "chatgpt_generate",
        instructions: "x",
        input: "x",
        model: "bad model",
      }).success,
    ).toBe(false);
  });

  it("parses every kind of value", () => {
    const file = { path: "a.ts", status: "M", additions: 1, deletions: 0, binary: false };
    const values = [
      {
        kind: "log",
        commits: [
          {
            oid: "a".repeat(40),
            shortOid: "aaaaaaa",
            parents: [],
            authorName: "A",
            authorEmail: "a@example.test",
            authoredAt: "2026-01-01T00:00:00Z",
            committedAt: "2026-01-01T00:00:00Z",
            subject: "initial",
            refs: ["main"],
          },
        ],
        nextCursor: null,
        head: "a".repeat(40),
        upstream: null,
      },
      { kind: "commit_detail", oid: "a".repeat(40), message: "initial\n", files: [file] },
      {
        kind: "commit_diff",
        oid: "a".repeat(40),
        path: null,
        patch: "",
        binary: false,
        truncated: false,
      },
      { kind: "diff_all", area: "working", patch: "", truncated: false, untrackedOmitted: false },
      {
        kind: "range_diff",
        base: "main",
        head: "x",
        mergeBase: "y",
        patch: "",
        truncated: false,
        files: [],
      },
      { kind: "staged_context", branch: null, files: [], patch: "", truncated: false },
      {
        kind: "range_context",
        base: "main",
        head: "x",
        mergeBase: "y",
        commits: [{ oid: "x", subject: "s", body: "", author: "A" }],
        files: [],
        patch: "",
        truncated: false,
      },
      {
        kind: "stash_list",
        entries: [{ index: 0, message: "WIP", createdAt: "2026-01-01T00:00:00Z" }],
      },
      {
        kind: "tree",
        path: ".",
        entries: [{ name: "src", path: "src", type: "directory", ignored: false }],
        truncated: false,
      },
      {
        kind: "file",
        path: "a.ts",
        content: "",
        encoding: "text",
        token: "0".repeat(64),
        size: 0,
        truncated: false,
        binary: false,
        mime: null,
      },
      { kind: "file_write", path: "a.ts", status: "conflict", token: "0".repeat(64) },
      {
        kind: "search",
        files: [
          {
            path: "a.ts",
            token: "0".repeat(64),
            matches: [{ line: 1, column: 1, length: 4, preview: "todo", previewOffset: 0 }],
            truncated: false,
          },
        ],
        totalMatches: 1,
        truncated: false,
        filesSearched: 1,
        filesSkipped: 0,
      },
      {
        kind: "replace",
        files: [{ path: "a.ts", replaced: 1, status: "ok" }],
        replaced: 1,
        skipped: 0,
      },
      {
        kind: "chatgpt_status",
        state: "ready",
        account: {
          label: "person@example.com",
          email: "person@example.com",
          scopes: ["openid", "chatgpt.tokens.use.direct"],
          planUsage: true,
          newRegistration: false,
        },
      },
      {
        kind: "chatgpt_models",
        models: [{ id: "gpt-5", label: "GPT-5" }],
      },
      {
        kind: "chatgpt_generation",
        outcome: "completed",
        text: "feat: use ChatGPT",
        model: "gpt-5",
      },
      {
        kind: "chatgpt_generation",
        outcome: "failed",
        reason: "usage_limit",
        httpStatus: 429,
        requestId: "req_123",
      },
    ];
    for (const value of values) {
      const parsed = WorkspaceValue.safeParse(value);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
    expect(WorkspaceValue.safeParse({ kind: "nothing" }).success).toBe(false);
  });
});
