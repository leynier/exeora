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
  /** A `cloud` machine is an instance: one Exeora Cloud runs for one workspace. */
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

/**
 * What a location, a machine or an instance is doing.
 *
 * One vocabulary for every page, computed by the gateway, so the dashboard
 * never has to decide from two booleans and a timestamp whether something is
 * asleep or gone. `not cloned` is only ever a location, `no instance` only
 * ever Exeora Cloud as a location, and `removing` only ever an instance.
 */
export type State =
  | "online"
  | "asleep"
  | "offline"
  | "setting up"
  | "failed"
  | "not cloned"
  | "no instance"
  | "removing"
  | "removed";

/**
 * A place a project has a copy: one of the person's machines, or Exeora Cloud.
 *
 * Named `ProjectLocation` because `Location` is already the browser's and the
 * router's word for an address.
 */
export interface ProjectLocation {
  id: string;
  kind: "local" | "cloud";
  /** Null for Exeora Cloud while it holds no copy of the project root. */
  deviceId: string | null;
  /** The machine's name, or "Exeora Cloud". */
  name: string;
  /** What `where` takes when a workspace is made: `laptop`, `cloud`. */
  slug: string;
  localPath: string | null;
  status: "pending" | "cloning" | "ready" | "error";
  /** Why the copy could not be made, as a sentence to act on. */
  error: string | null;
  errorCode: string | null;
  /** Where a call that names no workspace lands. */
  default: boolean;
  online: boolean;
  state: State;
  createdAt: number;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  /** The machine of the default location. It names no machine while `nowhere` is set. */
  deviceId: string;
  /**
   * The project has no default machine: its last machine was deleted, or the
   * instance that held its root was destroyed. It keeps its URL, its policy
   * and its clients, and its root cannot be opened until it has a copy again.
   */
  nowhere: boolean;
  localPath: string;
  /** The git remote. Null for a directory that has none, which lives where it is. */
  repoUrl: string | null;
  defaultBranch: string | null;
  locations: ProjectLocation[];
  mcpUrl: string;
  policy: CommandPolicy;
  createdAt: number;
  /** Set when the project is on Exeora Cloud. */
  cloud: { repoUrl: string; defaultBranch: string; hasCredential: boolean } | null;
  /** Set when the repository was picked from a connected GitHub account. */
  github: { fullName: string; private: boolean; lostAccess: boolean } | null;
}

/** A branch with a working copy of its own. The project root is not one of these. */
export interface Workspace {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  branch: string | null;
  localPath: string;
  managed: boolean;
  /** The machine that holds the working copy. On Exeora Cloud that is its instance. */
  deviceId: string | null;
  /** Whether that machine is an instance Exeora Cloud runs for this workspace alone. */
  cloud: boolean;
  /** The name of that machine, for a row that has to say where the workspace is. */
  machine: string | null;
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
  | { action: "branch_delete"; name: string };

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
  /** Whether this account may put projects on Exeora Cloud. */
  cloudEnabled: boolean;
  /** The one MCP URL that covers every project a client is given. */
  accountMcpUrl: string;
  /** The CLI release a machine should be running. Null on a gateway that does not say. */
  latestCliVersion?: string | null;
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
  /** Given every project, including the ones created later. */
  allProjects: boolean;
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

/** One of the two scripts a project runs inside its instances on Exeora Cloud. */
export type CloudHook = "install" | "resume";

/**
 * The scripts of a project, as its page holds them.
 *
 * A null script is an empty field, which is how a person says "use the file
 * in the repository". A project that never saved any answers nulls, the
 * repository's files switched on, and no date.
 */
export interface CloudScripts {
  install: string | null;
  resume: string | null;
  /** Whether the files in the repository run where the page has no script. */
  runRepositoryScripts: boolean;
  updatedAt: number | null;
}

/** What saving sends: everything above but the date, which is the gateway's. */
export type CloudScriptsInput = Omit<CloudScripts, "updatedAt">;
