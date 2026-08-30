import { z } from "zod";

const worktreeBranch = z.string().min(1).max(255);
const worktreeSlug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .refine((slug) => slug !== "main", "main is reserved");

export const WorktreeSummary = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().nullable(),
  managed: z.boolean(),
});

export const ListGitWorktreesInput = z.object({});
export const ListGitWorktreesOutput = z.object({
  worktrees: z.array(
    z.object({
      path: z.string().min(1),
      branch: z.string().nullable(),
      primary: z.boolean(),
      connected: z.boolean(),
      connectedSlug: z.string().optional(),
    }),
  ),
});

export const CreateWorktreeInput = z
  .object({
    branch: worktreeBranch.describe("Branch to create or reuse in the new worktree."),
    from: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe("Git ref to base a new branch on. Cannot be used with reuseExistingBranch."),
    reuseExistingBranch: z
      .boolean()
      .optional()
      .describe("Use an existing local branch instead of creating one. Defaults to false."),
    name: z.string().min(1).max(100).optional().describe("Display name. Defaults to the branch."),
    slug: worktreeSlug
      .optional()
      .describe("Stable URL-safe selector. Derived from the branch by default."),
  })
  .refine((input) => !(input.from && input.reuseExistingBranch), {
    message: "from cannot be used with reuseExistingBranch",
    path: ["reuseExistingBranch"],
  });

export const AttachWorktreeInput = z
  .object({
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Absolute path of an existing Git worktree. Pass exactly one of path or branch."),
    branch: worktreeBranch
      .optional()
      .describe(
        "Exact branch checked out in an existing Git worktree. Pass exactly one of branch or path.",
      ),
    name: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe("Display name for the connected worktree."),
    slug: worktreeSlug
      .optional()
      .describe("Stable URL-safe selector. Derived automatically by default."),
  })
  .refine((input) => (input.path === undefined) !== (input.branch === undefined), {
    message: "Pass exactly one of path or branch",
  });

export const DetachWorktreeInput = z.object({});
export const RemoveWorktreeInput = z.object({
  force: z
    .boolean()
    .optional()
    .describe("Remove even when the worktree has uncommitted changes. Defaults to false."),
  deleteBranch: z
    .boolean()
    .optional()
    .describe("Also delete the local branch with Git's safe branch -d. Defaults to false."),
});

export const ConnectWorktreeOutput = z.object({
  worktree: WorktreeSummary,
  outcome: z.enum(["active", "pendingUpsert"]),
});
export const DetachWorktreeOutput = z.object({
  worktree: WorktreeSummary,
  outcome: z.enum(["detached", "pendingDelete"]),
});
export const RemoveWorktreeOutput = z.object({
  worktree: WorktreeSummary,
  outcome: z.enum(["removed", "pendingDelete"]),
  branchDeleted: z.boolean(),
});

export const WORKTREE_TOOL_DEFINITIONS = {
  list_git_worktrees: {
    title: "List Git worktrees",
    description:
      "List every Git worktree in this repository, including worktrees that are not connected " +
      "to Exeora. Returns absolute local paths so one can be passed to attach_worktree. Requires " +
      "the connected machine to be online; list_worktrees is the offline inventory of connected worktrees.",
    inputSchema: ListGitWorktreesInput,
    outputSchema: ListGitWorktreesOutput,
    readOnly: true,
  },
  create_worktree: {
    title: "Create worktree",
    description:
      "Create a native Git worktree under Exeora's managed worktree root and connect it to this " +
      "project. Omit the routing worktree to base it on the project root's HEAD, or name a connected " +
      "worktree to use that checkout as the source.",
    inputSchema: CreateWorktreeInput,
    outputSchema: ConnectWorktreeOutput,
    readOnly: false,
  },
  attach_worktree: {
    title: "Attach worktree",
    description:
      "Connect an existing Git worktree to Exeora without taking ownership of it. Pass exactly " +
      "one absolute path or exact branch; use list_git_worktrees to discover candidates.",
    inputSchema: AttachWorktreeInput,
    outputSchema: ConnectWorktreeOutput,
    readOnly: false,
  },
  detach_worktree: {
    title: "Detach worktree",
    description:
      "Disconnect a worktree from Exeora without changing or deleting the Git checkout. The MCP " +
      "routing worktree argument is required and names the worktree to detach.",
    inputSchema: DetachWorktreeInput,
    outputSchema: DetachWorktreeOutput,
    readOnly: false,
  },
  remove_worktree: {
    title: "Remove worktree",
    description:
      "Disconnect and physically remove a Git worktree. Refuses uncommitted changes unless force " +
      "is true, and keeps the branch unless deleteBranch is true. The MCP routing worktree argument is required.",
    inputSchema: RemoveWorktreeInput,
    outputSchema: RemoveWorktreeOutput,
    readOnly: false,
    destructive: true,
  },
} as const;
