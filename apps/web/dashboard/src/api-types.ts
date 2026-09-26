/**
 * The shapes the gateway answers with, restated for the dashboard.
 *
 * Kept apart from the calls in `api.ts` so a page can import a type without
 * pulling the fetch layer along, and so neither file has to fight the length
 * ceiling as the API grows.
 */

export interface Device {
  id: string;
  name: string;
  platform: string;
  /** A `cloud` machine is one Exeora runs; it is managed from the Cloud page. */
  kind: "local" | "cloud";
  cliVersion: string | null;
  online: boolean;
  lastSeenAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

/** Restated from `@exeora/protocol` so the dashboard bundle skips zod. */
export interface CommandPolicy {
  mode: "allow_all" | "allow_list" | "read_only";
  allow: string[];
  deny: string[];
  shell: boolean;
  approve: boolean;
  tools: ToolName[] | null;
}

export const TOOL_NAMES = [
  "read_file",
  "list_files",
  "grep",
  "edit_file",
  "write_file",
  "apply_patch",
  "run_command",
  "start_command",
  "get_command_output",
  "send_command_input",
  "kill_command",
  "list_skills",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export interface Project {
  id: string;
  slug: string;
  name: string;
  deviceId: string;
  localPath: string;
  mcpUrl: string;
  policy: CommandPolicy;
  createdAt: number;
  /** Set when the project is a repository on Exeora Cloud rather than a local directory. */
  cloud: { repoUrl: string; defaultBranch: string } | null;
}

export interface Workspace {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  branch: string | null;
  localPath: string;
  managed: boolean;
  /** The machine holding this checkout, when it is not the project's own. */
  deviceId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceCapabilities {
  online: boolean;
  sourceControl: boolean;
  terminal: boolean;
  workspaceRouting: boolean;
}

export interface GitFileState {
  path: string;
  originalPath?: string | null;
  index: string;
  /** Git porcelain XY working-tree letter, not an Exeora workspace id. */
  worktree: string;
  kind: "tracked" | "untracked" | "conflict";
  submodule: boolean;
}

export interface GitBranch {
  name: string;
  shortOid: string;
  upstream: string | null;
  /** Commits not on the upstream; null when there is no upstream to compare with. */
  ahead?: number | null;
  remote: boolean;
  current: boolean;
}

export interface GitWorkspaceCheckout {
  path: string;
  branch: string | null;
}

export interface GitStatus {
  kind: "status";
  repository: boolean;
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  operation: "merge" | "rebase" | "cherry-pick" | "revert" | "bisect" | null;
  files: GitFileState[];
  branches: GitBranch[];
  remotes: string[];
  gitWorkspaces?: GitWorkspaceCheckout[];
  stashes?: number;
}

export interface GitDiff {
  kind: "diff";
  path: string;
  area: "working" | "staged";
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export type WorkspaceAction =
  | { action: "stage" | "unstage" | "discard" | "delete_untracked"; paths: string[] }
  | { action: "commit"; message: string }
  | { action: "fetch"; remote?: string; all?: boolean }
  | { action: "pull"; remote?: string; branch?: string }
  | { action: "push"; remote?: string; setUpstream?: boolean }
  | { action: "branch_create"; name: string; startPoint?: string }
  | { action: "branch_switch"; name: string }
  | { action: "branch_track"; name: string; remoteBranch: string }
  | { action: "branch_delete"; name: string }
  | {
      action: "workspace_create";
      branch: string;
      from?: string;
      reuseExistingBranch?: boolean;
      name?: string;
      slug?: string;
    };

export interface WorkspaceMutationResult {
  kind: "mutation";
  stdout: string;
  stderr: string;
  status: GitStatus;
  workspace?: {
    id: string;
    slug: string;
    name: string;
    branch: string | null;
    localPath: string;
  };
}

export interface ToolCall {
  id: string;
  projectId: string;
  workspaceId: string | null;
  workspaceSlug: string | null;
  tool: string;
  status: "ok" | "error";
  durationMs: number;
  errorCode: string | null;
  clientId: string | null;
  clientName: string | null;
  createdAt: number;
}

/**
 * An AI client authorized against one project.
 *
 * Two names, because neither is always there. `clientName` is what the
 * application registered with the authorization server; `mcpName` is what the
 * software calls itself over MCP, and only that one carries a version.
 */
export interface Client {
  id: string;
  projectId: string;
  /**
   * Which URL this access was granted through. Two rows can name the same
   * client and the same project and mean different consents, so the view has to
   * say which one it is showing.
   */
  endpoint: "project" | "account";
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  mcpName: string | null;
  mcpVersion: string | null;
  authorizedAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Caps that come with the account's plan. Null means no cap. */
export interface PlanLimits {
  maxDevices: number | null;
  maxProjects: number | null;
  maxCloudMachines: number | null;
  retentionDays: number;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /** Which plan this account is on. There is no self-serve upgrade yet. */
  plan: "free" | "pro";
  /** True when this account's email is on the fixed admin allow-list. */
  isAdmin: boolean;
  /** Whether this account may put repositories on machines Exeora runs. */
  cloudEnabled: boolean;
  /** The one MCP URL that covers every project a client is given. */
  accountMcpUrl: string;
  limits: PlanLimits;
  usage: {
    devices: number;
    projects: number;
    cloudMachines: number;
    toolCallsMonth: number;
  };
}

/** Global totals for the administration overview. */
export interface AdminOverview {
  users: number;
  devices: number;
  devicesOnline: number;
  projects: number;
  clients: number;
  toolCalls: number;
  toolCalls24h: number;
  toolCalls7d: number;
  /** 0–1 fraction of tool calls in the last 7 days that failed. */
  errorRate7d: number;
  usageWindow: "rolling" | "complete_utc_days";
}

/** One row of the admin user list. */
export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: number;
  devices: number;
  devicesOnline: number;
  projects: number;
  clients: number;
  toolCalls: number;
  lastActivityAt: number | null;
  cloudEnabled: boolean;
}

/** Full admin view of one account. */
export interface AdminUserDetail extends AdminUserSummary {
  machineList: Device[];
  projectList: Array<{
    id: string;
    name: string;
    slug: string;
    deviceId: string;
    localPath: string;
    createdAt: number;
  }>;
  clientList: Client[];
  recentCalls: ToolCall[];
}

/** One project an account-endpoint client was given, as that view lists it. */
export interface AccountClientProject {
  /** The `project_clients` row, which is what revoking acts on. */
  id: string;
  projectId: string;
  revokedAt: number | null;
}

/**
 * A client connected through the account URL.
 *
 * One entry per client rather than per project, because that is what it is: one
 * connection that reaches several projects. Each call names its project when
 * the connection reaches more than one.
 */
export interface AccountClient {
  clientId: string;
  clientName: string | null;
  clientUri: string | null;
  mcpName: string | null;
  mcpVersion: string | null;
  authorizedAt: number;
  lastUsedAt: number | null;
  projects: AccountClientProject[];
}

/**
 * How the activity log is narrowed. Every field is optional and applied by the
 * server, so a filter searches the whole log rather than the page in hand.
 */
export interface ToolCallFilters {
  projectId?: string;
  workspaceId?: string;
  status?: "ok" | "error";
  clientId?: string;
}

/** One page of the audit log. `cursor` is null on the last one. */
export interface ToolCallPage {
  items: ToolCall[];
  cursor: string | null;
}

/**
 * A call waiting on someone to confirm it.
 *
 * Lives for ninety seconds inside the relay rather than in a table: there is an
 * AI client holding a request open at the other end of it, so it is either
 * answered now or not at all.
 */
export interface Approval {
  id: string;
  deviceId: string;
  deviceName: string;
  projectId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  tool: string;
  /** Already written for a person: "Run `npm test`?" */
  prompt: string;
  clientName?: string;
  requestedAt: number;
  expiresAt: number;
}
