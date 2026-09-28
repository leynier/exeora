import { describe, expect, it } from "vitest";
import { curatedModels, defaultModel, mergeModels } from "./catalog.js";
import {
  COMMIT_SYSTEM,
  commitPrompt,
  PROMPT_CAPS,
  PULL_REQUEST_SYSTEM,
  pullRequestPrompt,
} from "./prompts.js";

const file = (path: string, additions = 1, deletions = 0) => ({
  path,
  status: "M" as const,
  additions,
  deletions,
  binary: false,
});

describe("commitPrompt", () => {
  it("lists the branch, the files and the fenced patch, then the person's instructions", () => {
    const { system, user } = commitPrompt(
      {
        branch: "feature",
        files: [file("src/a.ts", 3, 1), { ...file("b.bin"), binary: true }],
        patch: "diff --git a/src/a.ts b/src/a.ts",
        truncated: false,
      },
      "  Mention the ticket.  ",
    );
    expect(system).toBe(COMMIT_SYSTEM);
    expect(user).toBe(
      [
        "Branch: feature",
        "",
        "Staged files:",
        "- src/a.ts (+3 -1)",
        "- b.bin (binary)",
        "",
        "Staged patch:",
        "```diff",
        "diff --git a/src/a.ts b/src/a.ts",
        "```",
        "",
        "Additional user instructions:",
        "Mention the ticket.",
      ].join("\n"),
    );
  });

  it("leaves the instructions out when there are none, and names a detached head", () => {
    const { user } = commitPrompt({ branch: null, files: [], patch: "", truncated: false }, null);
    expect(user).toContain("Branch: (detached HEAD)");
    expect(user).toContain("Staged files:\n(none)");
    expect(user).not.toContain("Additional user instructions");
  });

  it("caps the file list, the patch and the instructions", () => {
    const files = Array.from({ length: 400 }, (_, i) => file(`src/${"n".repeat(40)}-${i}.ts`));
    const { user } = commitPrompt(
      { branch: "main", files, patch: "x".repeat(PROMPT_CAPS.patch + 10), truncated: false },
      "y".repeat(PROMPT_CAPS.instructions + 10),
    );
    const listed = user.slice(user.indexOf("Staged files:"), user.indexOf("Staged patch:"));
    expect(listed.length).toBeLessThan(PROMPT_CAPS.files + 100);
    expect(listed).toMatch(/\.\.\. \(\d+ more files\)/);
    expect(user).toContain("[patch truncated]");
    expect(user.length).toBeLessThan(
      PROMPT_CAPS.patch + PROMPT_CAPS.files + PROMPT_CAPS.instructions + 500,
    );
    expect(user.endsWith("y".repeat(PROMPT_CAPS.instructions))).toBe(true);
    expect(user).not.toContain("y".repeat(PROMPT_CAPS.instructions + 1));
  });

  it("says when the machine already truncated the patch", () => {
    const { user } = commitPrompt({ branch: "main", files: [], patch: "d", truncated: true }, null);
    expect(user).toContain("d\n[patch truncated]\n```");
  });
});

describe("pullRequestPrompt", () => {
  it("names both branches, the commits newest first and the changed files", () => {
    const { system, user } = pullRequestPrompt(
      {
        base: "main",
        head: "feature",
        commits: [
          { oid: "abcdef0123456789", subject: "Second", body: "", author: "a" },
          { oid: "0123456789abcdef", subject: "First", body: "", author: "a" },
        ],
        files: [file("README.md")],
        patch: "diff",
        truncated: false,
      },
      null,
    );
    expect(system).toBe(PULL_REQUEST_SYSTEM);
    expect(user).toContain("Base branch: main\nHead branch: feature");
    expect(user).toContain("Commits (newest first):\n- abcdef0 Second\n- 0123456 First");
    expect(user).toContain("Changed files:\n- README.md (+1 -0)");
    expect(user).toContain("Patch range:\n```diff\ndiff\n```");
  });

  it("caps the commit list", () => {
    const commits = Array.from({ length: 300 }, (_, i) => ({
      oid: `${i}`.padStart(40, "0"),
      subject: "s".repeat(60),
      body: "",
      author: "a",
    }));
    const { user } = pullRequestPrompt(
      { base: "main", head: "f", commits, files: [], patch: "", truncated: false },
      null,
    );
    const listed = user.slice(user.indexOf("Commits"), user.indexOf("Changed files:"));
    expect(listed.length).toBeLessThan(PROMPT_CAPS.commits + 100);
    expect(listed).toMatch(/\.\.\. \(\d+ more commits\)/);
  });
});

describe("catalog", () => {
  it("offers the curated list first and the provider's additions after, capped", () => {
    const merged = mergeModels("xai", [
      { id: "grok-4" },
      { id: "grok-3", label: "Grok 3" },
      { id: "grok-2" },
      ...Array.from({ length: 80 }, (_, i) => ({
        id: `grok-extra-${i.toString().padStart(2, "0")}`,
      })),
    ]);
    expect(merged.slice(0, 3)).toEqual(curatedModels("xai"));
    expect(merged[3]).toEqual({ id: "grok-2", label: "grok-2" });
    expect(merged[4]).toEqual({ id: "grok-3", label: "Grok 3" });
    expect(merged).toHaveLength(50);
    expect(defaultModel("openai")).toBe("gpt-5.5");
  });
});
