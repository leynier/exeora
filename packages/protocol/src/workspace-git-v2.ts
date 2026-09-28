import { z } from "zod";

/**
 * Source Control v2: history, aggregate diffs, the context an assistant reads
 * to write a commit or a pull request, amend, stash and sync. Announced by a
 * CLI as `source-control-v2`; the v1 actions live in `workspace.ts`.
 */

const path = z.string().min(1).max(4_096);
/** A commit named by its hash, never a ref: git reads a ref that starts with `-` as an option. */
const oid = z.string().regex(/^[0-9a-f]{4,64}$/);
const ref = z.string().min(1).max(512);
const optionalRef = ref.optional();

export const GitCommit = z.object({
  oid: z.string(),
  shortOid: z.string(),
  parents: z.array(z.string()),
  authorName: z.string(),
  authorEmail: z.string(),
  /** ISO 8601. */
  authoredAt: z.string(),
  committedAt: z.string(),
  subject: z.string(),
  /** Branches and tags at this commit, as `git log --decorate` names them. */
  refs: z.array(z.string()),
});

export type GitCommit = z.infer<typeof GitCommit>;

export const GitLog = z.object({
  kind: z.literal("log"),
  commits: z.array(GitCommit),
  /** Opaque; sent back as `cursor` for the next page, absent on the last. */
  nextCursor: z.string().nullable(),
  head: z.string().nullable(),
  upstream: z.string().nullable(),
});

export type GitLog = z.infer<typeof GitLog>;

export const GitCommitFile = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(["A", "M", "D", "R", "C", "T"]),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  binary: z.boolean(),
});

export type GitCommitFile = z.infer<typeof GitCommitFile>;

export const GitCommitDetail = z.object({
  kind: z.literal("commit_detail"),
  oid: z.string(),
  message: z.string(),
  files: z.array(GitCommitFile),
});

export type GitCommitDetail = z.infer<typeof GitCommitDetail>;

export const GitCommitDiff = z.object({
  kind: z.literal("commit_diff"),
  oid: z.string(),
  path: z.string().nullable(),
  patch: z.string(),
  binary: z.boolean(),
  truncated: z.boolean(),
});

export type GitCommitDiff = z.infer<typeof GitCommitDiff>;

export const GitDiffAll = z.object({
  kind: z.literal("diff_all"),
  area: z.enum(["working", "staged"]),
  patch: z.string(),
  truncated: z.boolean(),
  /** Untracked files that did not fit under the output cap. */
  untrackedOmitted: z.boolean(),
});

export type GitDiffAll = z.infer<typeof GitDiffAll>;

export const GitRangeDiff = z.object({
  kind: z.literal("range_diff"),
  base: z.string(),
  head: z.string(),
  mergeBase: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
  files: z.array(GitCommitFile),
});

export type GitRangeDiff = z.infer<typeof GitRangeDiff>;

export const GitStagedContext = z.object({
  kind: z.literal("staged_context"),
  branch: z.string().nullable(),
  files: z.array(GitCommitFile),
  patch: z.string(),
  truncated: z.boolean(),
});

export type GitStagedContext = z.infer<typeof GitStagedContext>;

export const GitContextCommit = z.object({
  oid: z.string(),
  subject: z.string(),
  body: z.string(),
  author: z.string(),
});

export const GitRangeContext = z.object({
  kind: z.literal("range_context"),
  base: z.string(),
  head: z.string(),
  mergeBase: z.string(),
  commits: z.array(GitContextCommit).max(40),
  files: z.array(GitCommitFile),
  patch: z.string(),
  truncated: z.boolean(),
});

export type GitRangeContext = z.infer<typeof GitRangeContext>;

export const GitStashEntry = z.object({
  index: z.number().int().min(0),
  message: z.string(),
  /** ISO 8601. */
  createdAt: z.string(),
});

export const GitStashList = z.object({
  kind: z.literal("stash_list"),
  entries: z.array(GitStashEntry),
});

export type GitStashList = z.infer<typeof GitStashList>;

/** Reads: none takes the CLI's mutation lock. */
export const GIT_V2_READ_ACTIONS = [
  z.object({
    action: z.literal("log"),
    cursor: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  /** `commit_detail`, not `commit`: that name is the v1 mutation that makes one. */
  z.object({ action: z.literal("commit_detail"), oid }),
  z.object({ action: z.literal("commit_diff"), oid, path: path.optional() }),
  z.object({ action: z.literal("diff_all"), area: z.enum(["working", "staged"]) }),
  z.object({ action: z.literal("range_diff"), base: ref }),
  z.object({ action: z.literal("staged_context") }),
  z.object({ action: z.literal("range_context"), base: ref }),
  z.object({ action: z.literal("stash_list") }),
] as const;

export const GIT_V2_MUTATION_ACTIONS = [
  z.object({
    action: z.literal("amend"),
    message: z.string().trim().min(1).max(10_000).optional(),
  }),
  z.object({
    action: z.literal("stash_push"),
    message: z.string().trim().min(1).max(1_000).optional(),
    includeUntracked: z.boolean().default(true),
  }),
  z.object({ action: z.literal("stash_pop"), index: z.number().int().min(0).default(0) }),
  z.object({ action: z.literal("stash_drop"), index: z.number().int().min(0) }),
  /** Pull, then push, under one lock. */
  z.object({ action: z.literal("sync"), remote: optionalRef }),
  z.object({ action: z.literal("discard_all") }),
] as const;

export const GIT_V2_VALUES = [
  GitLog,
  GitCommitDetail,
  GitCommitDiff,
  GitDiffAll,
  GitRangeDiff,
  GitStagedContext,
  GitRangeContext,
  GitStashList,
] as const;
