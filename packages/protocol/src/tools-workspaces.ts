import { z } from "zod";

const workspaceBranch = z.string().min(1).max(255);
const workspaceSlug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .refine((slug) => slug !== "main", "main is reserved");

export const WorkspaceSummary = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().nullable(),
  managed: z.boolean(),
});

/**
 * Which of the project's locations a tool acts on: the name of one of the
 * user's machines, or `cloud`. Resolved by the gateway and never sent to a
 * machine, which by then is the one that was chosen.
 */
const location = z.string().min(1).max(200);

export const ListGitWorkspacesInput = z.object({
  where: location
    .optional()
    .describe("Location to ask: a machine name or `cloud`. Defaults to the project's default."),
});

export const ListGitWorkspacesOutput = z.object({
  workspaces: z.array(
    z.object({
      path: z.string().min(1),
      branch: z.string().nullable(),
      primary: z.boolean(),
      connected: z.boolean(),
      connectedSlug: z.string().optional(),
    }),
  ),
});

export const CreateWorkspaceInput = z
  .object({
    branch: workspaceBranch.describe("Branch to create or reuse in the new workspace."),
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
    slug: workspaceSlug
      .optional()
      .describe("Stable URL-safe selector. Derived from the branch by default."),
    where: location
      .optional()
      .describe(
        "Location to create it in: a machine name or `cloud`, from list_projects. Defaults to the project's default location.",
      ),
  })
  .refine((input) => !(input.from && input.reuseExistingBranch), {
    message: "from cannot be used with reuseExistingBranch",
    path: ["reuseExistingBranch"],
  });

export const AttachWorkspaceInput = z
  .object({
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Absolute path of an existing Git workspace. Pass exactly one of path or branch."),
    branch: workspaceBranch
      .optional()
      .describe(
        "Exact branch checked out in an existing Git workspace. Pass exactly one of branch or path.",
      ),
    name: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe("Display name for the connected workspace."),
    slug: workspaceSlug
      .optional()
      .describe("Stable URL-safe selector. Derived automatically by default."),
  })
  .refine((input) => (input.path === undefined) !== (input.branch === undefined), {
    message: "Pass exactly one of path or branch",
  });

export const DetachWorkspaceInput = z.object({});

export const RemoveWorkspaceInput = z.object({
  force: z
    .boolean()
    .optional()
    .describe("Remove even when the workspace has uncommitted changes. Defaults to false."),
  deleteBranch: z
    .boolean()
    .optional()
    .describe("Also delete the local branch with Git's safe branch -d. Defaults to false."),
});

export const ConnectWorkspaceOutput = z.object({
  workspace: WorkspaceSummary,
  outcome: z.enum(["active", "pendingUpsert"]),
});

export const DetachWorkspaceOutput = z.object({
  workspace: WorkspaceSummary,
  outcome: z.enum(["detached", "pendingDelete"]),
});

export const RemoveWorkspaceOutput = z.object({
  workspace: WorkspaceSummary,
  outcome: z.enum(["removed", "pendingDelete"]),
  branchDeleted: z.boolean(),
});

export const WORKSPACE_TOOL_DEFINITIONS = {
  list_git_workspaces: {
    title: "List Git workspaces",
    description:
      "List every Git workspace of this repository on one of the user's machines, including ones " +
      "that are not connected to Exeora. Returns absolute local paths so one can be passed to " +
      "attach_workspace. Requires that machine to be online; list_workspaces is the inventory of " +
      "connected workspaces across every location and works offline.",
    inputSchema: ListGitWorkspacesInput,
    outputSchema: ListGitWorkspacesOutput,
    readOnly: true,
  },
  create_workspace: {
    title: "Create workspace",
    description:
      "Create a workspace: a branch with a working copy of its own, in one of the project's " +
      "locations. `where` chooses the location, a machine name or `cloud`; without it the default " +
      "location is used. Omit the routing workspace to base it on the project root's HEAD, or name " +
      "a connected workspace to start from that checkout, beside it. The first workspace on a " +
      "machine clones the repository there, and one on Exeora Cloud starts a machine, so this can " +
      "take a minute. Always use this tool rather than executing raw git commands.",
    inputSchema: CreateWorkspaceInput,
    outputSchema: ConnectWorkspaceOutput,
    readOnly: false,
  },
  attach_workspace: {
    title: "Attach workspace",
    description:
      "Connect an existing Git workspace to Exeora without taking ownership of it. Pass exactly " +
      "one absolute path or exact branch; use list_git_workspaces to discover candidates.",
    inputSchema: AttachWorkspaceInput,
    outputSchema: ConnectWorkspaceOutput,
    readOnly: false,
  },
  detach_workspace: {
    title: "Detach workspace",
    description:
      "Disconnect a workspace from Exeora without changing or deleting the Git checkout. The MCP " +
      "routing workspace argument is required and names the workspace to detach.",
    inputSchema: DetachWorkspaceInput,
    outputSchema: DetachWorkspaceOutput,
    readOnly: false,
  },
  remove_workspace: {
    title: "Remove workspace",
    description:
      "Disconnect and physically remove a workspace. Refuses uncommitted changes unless force " +
      "is true, and on Exeora Cloud also work that was never pushed, since the machine is its only " +
      "copy. Keeps the branch unless deleteBranch is true. The MCP routing workspace argument is " +
      "required. Always use this tool rather than executing raw git commands.",
    inputSchema: RemoveWorkspaceInput,
    outputSchema: RemoveWorkspaceOutput,
    readOnly: false,
    destructive: true,
  },
} as const;

export type WorkspaceToolName = keyof typeof WORKSPACE_TOOL_DEFINITIONS;

/**
 * The tools that manage a project's checkouts rather than work inside one.
 * Named separately because a cloud project answers them at the gateway, where
 * a workspace is a machine to create or destroy, not a worktree on disk.
 */
export const WORKSPACE_TOOL_NAMES = Object.keys(WORKSPACE_TOOL_DEFINITIONS) as WorkspaceToolName[];

export function isWorkspaceToolName(value: unknown): value is WorkspaceToolName {
  return typeof value === "string" && value in WORKSPACE_TOOL_DEFINITIONS;
}
