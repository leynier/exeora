import type { GitCommitFile, GitRangeContext, GitStagedContext } from "@exeora/protocol";

/**
 * What the provider is told. The rules are the system message; the context
 * read from the machine is the user message, capped so a large repository
 * cannot turn one request into a token bill, and followed by whatever the
 * person added in the settings.
 */

export const PROMPT_CAPS = {
  files: 6_000,
  commits: 8_000,
  patch: 200_000,
  instructions: 4_000,
} as const;

export interface Prompt {
  system: string;
  user: string;
}

export const COMMIT_SYSTEM = [
  "You are generating a single git commit message. Return only the commit message text. Do not include a preamble, quotes, or code fences.",
  "",
  "Rules:",
  "- First line: imperative mood, <= 72 chars, no trailing period.",
  "- Optional body: blank line, then short wrapped bullet points or prose explaining WHY.",
  "- Capture the primary user-visible or developer-visible change.",
  "- Use only the staged changes below as context.",
  '- Do not include "Co-authored-by" or other git trailers.',
].join("\n");

export const PULL_REQUEST_SYSTEM = [
  "You are generating a GitHub-style pull request title and description. Return only the PR text. Do not include a preamble, quotes, or code fences.",
  "",
  "Rules:",
  "- First line: concise PR title (imperative mood preferred, <= 72 chars, no trailing period).",
  "- Then a blank line.",
  "- Then a markdown-friendly description explaining WHAT changed and WHY.",
  "- Use only the commits and patch range below as context.",
  "- Do not invent reviewers, issue numbers, or screenshots that are not in the context.",
].join("\n");

export function commitPrompt(
  context: Pick<GitStagedContext, "branch" | "files" | "patch" | "truncated">,
  instructions: string | null,
): Prompt {
  const user = [
    `Branch: ${context.branch ?? "(detached HEAD)"}`,
    "",
    "Staged files:",
    fileList(context.files),
    "",
    "Staged patch:",
    fenced(context.patch, context.truncated),
    ...userInstructions(instructions),
  ].join("\n");
  return { system: COMMIT_SYSTEM, user };
}

export function pullRequestPrompt(
  context: Pick<GitRangeContext, "base" | "head" | "commits" | "files" | "patch" | "truncated">,
  instructions: string | null,
): Prompt {
  const user = [
    `Base branch: ${context.base}`,
    `Head branch: ${context.head}`,
    "",
    "Commits (newest first):",
    capped(
      context.commits.map((commit) => `- ${commit.oid.slice(0, 7)} ${commit.subject}`),
      PROMPT_CAPS.commits,
      "commits",
    ),
    "",
    "Changed files:",
    fileList(context.files),
    "",
    "Patch range:",
    fenced(context.patch, context.truncated),
    ...userInstructions(instructions),
  ].join("\n");
  return { system: PULL_REQUEST_SYSTEM, user };
}

function fileList(files: readonly GitCommitFile[]): string {
  if (files.length === 0) return "(none)";
  return capped(
    files.map((file) => {
      const name = file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
      const counts = file.binary ? "binary" : `+${file.additions} -${file.deletions}`;
      return `- ${name} (${counts})`;
    }),
    PROMPT_CAPS.files,
    "files",
  );
}

/** As many whole lines as fit, and how many were left out. */
function capped(lines: readonly string[], cap: number, noun: string): string {
  let used = 0;
  let kept = 0;
  for (const line of lines) {
    if (used + line.length + 1 > cap) break;
    used += line.length + 1;
    kept++;
  }
  const rest = lines.length - kept;
  return rest === 0
    ? lines.join("\n")
    : `${lines.slice(0, kept).join("\n")}\n... (${rest} more ${noun})`;
}

function fenced(patch: string, truncated: boolean): string {
  const cut = patch.length > PROMPT_CAPS.patch;
  const body = cut ? patch.slice(0, PROMPT_CAPS.patch) : patch;
  const note = cut || truncated ? "\n[patch truncated]" : "";
  return `\`\`\`diff\n${body}${note}\n\`\`\``;
}

function userInstructions(instructions: string | null): string[] {
  const text = instructions?.trim() ?? "";
  if (text === "") return [];
  return ["", "Additional user instructions:", text.slice(0, PROMPT_CAPS.instructions)];
}
