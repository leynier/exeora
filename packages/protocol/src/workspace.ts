import { z } from "zod";

const path = z.string().min(1).max(4_096);
const paths = z.array(path).min(1).max(1_000);
const optionalRef = z.string().min(1).max(512).optional();

export const GitFileState = z.object({
  path,
  originalPath: path.optional(),
  index: z.string().length(1),
  worktree: z.string().length(1),
  kind: z.enum(["tracked", "untracked", "conflict"]),
  submodule: z.boolean(),
});

export type GitFileState = z.infer<typeof GitFileState>;

export const GitBranch = z.object({
  name: z.string(),
  shortOid: z.string(),
  upstream: z.string().nullable(),
  remote: z.boolean(),
  current: z.boolean(),
});

export const GitStatus = z.object({
  kind: z.literal("status"),
  repository: z.boolean(),
  head: z.string().nullable(),
  oid: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int().min(0),
  behind: z.number().int().min(0),
  operation: z.enum(["merge", "rebase", "cherry-pick", "revert", "bisect"]).nullable(),
  files: z.array(GitFileState),
  branches: z.array(GitBranch),
  remotes: z.array(z.string()),
});

export type GitStatus = z.infer<typeof GitStatus>;

export const GitDiff = z.object({
  kind: z.literal("diff"),
  path,
  area: z.enum(["working", "staged"]),
  patch: z.string(),
  binary: z.boolean(),
  truncated: z.boolean(),
});

export type GitDiff = z.infer<typeof GitDiff>;

export const WorkspaceAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("diff"), path, area: z.enum(["working", "staged"]) }),
  z.object({ action: z.literal("stage"), paths }),
  z.object({ action: z.literal("unstage"), paths }),
  z.object({ action: z.literal("discard"), paths }),
  z.object({ action: z.literal("delete_untracked"), paths }),
  z.object({ action: z.literal("commit"), message: z.string().trim().min(1).max(10_000) }),
  z.object({ action: z.literal("fetch"), remote: optionalRef, all: z.boolean().default(false) }),
  z.object({ action: z.literal("pull"), remote: optionalRef, branch: optionalRef }),
  z.object({
    action: z.literal("push"),
    remote: optionalRef,
    setUpstream: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("branch_create"),
    name: z.string().min(1).max(255),
    startPoint: optionalRef,
  }),
  z.object({ action: z.literal("branch_switch"), name: z.string().min(1).max(255) }),
  z.object({
    action: z.literal("branch_track"),
    name: z.string().min(1).max(255),
    remoteBranch: z.string().min(1).max(512),
  }),
  z.object({ action: z.literal("branch_delete"), name: z.string().min(1).max(255) }),
]);

export type WorkspaceAction = z.infer<typeof WorkspaceAction>;

export const WorkspaceMutationResult = z.object({
  kind: z.literal("mutation"),
  stdout: z.string(),
  stderr: z.string(),
  status: GitStatus,
});

export type WorkspaceMutationResult = z.infer<typeof WorkspaceMutationResult>;

export const WorkspaceValue = z.union([GitStatus, GitDiff, WorkspaceMutationResult]);
export type WorkspaceValue = z.infer<typeof WorkspaceValue>;

const sessionId = z.string().min(1).max(128);

export const TerminalOpenMessage = z.object({
  type: z.literal("terminal.open"),
  sessionId,
  projectId: z.string(),
  worktreeId: z.string().optional(),
  worktreeSlug: z.string().optional(),
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
});

export const TerminalInputMessage = z.object({
  type: z.literal("terminal.input"),
  sessionId,
  data: z.string().max(128_000),
});

export const TerminalResizeMessage = z.object({
  type: z.literal("terminal.resize"),
  sessionId,
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
});

export const TerminalCloseMessage = z.object({
  type: z.literal("terminal.close"),
  sessionId,
});

export const TerminalOpenedMessage = z.object({
  type: z.literal("terminal.opened"),
  sessionId,
});

export const TerminalOutputMessage = z.object({
  type: z.literal("terminal.output"),
  sessionId,
  data: z.string().max(128_000),
});

export const TerminalExitMessage = z.object({
  type: z.literal("terminal.exit"),
  sessionId,
  exitCode: z.number().int().nullable(),
});

export const TerminalErrorMessage = z.object({
  type: z.literal("terminal.error"),
  sessionId,
  message: z.string().max(2_048),
});

export type TerminalOpenMessage = z.infer<typeof TerminalOpenMessage>;
export type TerminalInputMessage = z.infer<typeof TerminalInputMessage>;
export type TerminalResizeMessage = z.infer<typeof TerminalResizeMessage>;
export type TerminalCloseMessage = z.infer<typeof TerminalCloseMessage>;
export type TerminalOpenedMessage = z.infer<typeof TerminalOpenedMessage>;
export type TerminalOutputMessage = z.infer<typeof TerminalOutputMessage>;
export type TerminalExitMessage = z.infer<typeof TerminalExitMessage>;
export type TerminalErrorMessage = z.infer<typeof TerminalErrorMessage>;
