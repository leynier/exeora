/**
 * What the mocked gateway answers with, shaped as the real one answers.
 *
 * One account, seen from two sides. `project` is the small one the workspace
 * specs have always used: a repository on one laptop. `widgets` is the one
 * that lives in three locations, which is what the Projects and Machines specs
 * are about.
 */

const now = Date.now();

export const user = {
  id: "usr_e2e",
  email: "e2e@example.com",
  name: "E2E User",
  avatarUrl: null,
  plan: "free",
  isAdmin: false,
  cloudEnabled: false,
  accountMcpUrl: "https://exeora.test/mcp",
  limits: { maxDevices: 2, maxProjects: 3, maxCloudMachines: 2, retentionDays: 90 },
  usage: { devices: 0, projects: 1, cloudMachines: 0, toolCallsMonth: 0 },
};

export const cloudUser = {
  ...user,
  cloudEnabled: true,
  limits: { ...user.limits, maxCloudMachines: 10 },
  usage: { ...user.usage, devices: 2, projects: 2, cloudMachines: 3 },
};

const policy = {
  mode: "allow_all",
  allow: [],
  deny: [],
  shell: true,
  approve: false,
  tools: null,
};

export function location(patch: Record<string, unknown> = {}) {
  return {
    id: "loc_laptop",
    kind: "local" as "local" | "cloud",
    deviceId: "dev_e2e" as string | null,
    name: "Laptop",
    slug: "laptop",
    localPath: "/work/e2e" as string | null,
    status: "ready",
    error: null as string | null,
    errorCode: null as string | null,
    default: true,
    online: true,
    state: "online",
    createdAt: now,
    ...patch,
  };
}

export const project = {
  id: "prj_e2e",
  slug: "e2e",
  name: "E2E project",
  deviceId: "dev_e2e",
  localPath: "/work/e2e",
  repoUrl: "https://github.com/example/e2e.git" as string | null,
  defaultBranch: "main" as string | null,
  locations: [location()],
  mcpUrl: "https://exeora.test/p/prj_e2e/mcp",
  policy,
  createdAt: now,
  cloud: null as { repoUrl: string; defaultBranch: string; hasCredential: boolean } | null,
  github: null as { fullName: string; private: boolean; lostAccess: boolean } | null,
};

export const otherProject = {
  ...project,
  id: "prj_other",
  slug: "other",
  name: "Other project",
  localPath: "/work/other",
  repoUrl: "https://github.com/example/other.git",
  locations: [location({ id: "loc_other", localPath: "/work/other" })],
  mcpUrl: "https://exeora.test/p/prj_other/mcp",
};

export const workspace = {
  id: "wsp_feature",
  projectId: project.id,
  slug: "feature-trees",
  name: "Feature trees",
  branch: "feature/trees" as string | null,
  localPath: "/work/e2e/.worktrees/feature-trees",
  managed: true,
  deviceId: "dev_e2e" as string | null,
  cloud: false,
  machine: "Laptop" as string | null,
  createdAt: now,
  updatedAt: now,
};

export const laptop = {
  deviceId: "dev_e2e",
  kind: "local",
  name: "Laptop",
  platform: "linux",
  cliVersion: "0.18.0" as string | null,
  online: true,
  state: "online",
  lastSeenAt: now as number | null,
  createdAt: now,
  revokedAt: null as number | null,
  projects: [
    {
      projectId: project.id,
      slug: project.slug,
      name: project.name,
      localPath: project.localPath as string | null,
      status: "ready",
      error: null,
      default: true,
      workspaces: 1,
    },
  ],
};

/** A repository on a laptop, a desktop that has not cloned it yet, and Exeora Cloud. */
export const widgets = {
  ...project,
  id: "prj_widgets",
  slug: "widgets",
  name: "Widgets",
  deviceId: "dev_e2e",
  localPath: "/work/widgets",
  repoUrl: "https://github.com/example/widgets.git",
  defaultBranch: "master",
  locations: [
    location({ id: "loc_widgets_laptop", localPath: "/work/widgets" }),
    location({
      id: "loc_widgets_desktop",
      deviceId: "dev_desktop",
      name: "Desktop",
      slug: "desktop",
      localPath: null,
      status: "pending",
      default: false,
      state: "not cloned",
    }),
    location({
      id: "loc_widgets_cloud",
      kind: "cloud",
      deviceId: "dev_cloud_root",
      name: "Exeora Cloud",
      slug: "cloud",
      localPath: null,
      default: false,
      online: false,
      state: "asleep",
    }),
  ],
  mcpUrl: "https://exeora.test/p/prj_widgets/mcp",
  cloud: {
    repoUrl: "https://github.com/example/widgets.git",
    defaultBranch: "master",
    hasCredential: true,
  },
};

export const widgetsWorkspaces = [
  {
    ...workspace,
    id: "wsp_login",
    projectId: widgets.id,
    slug: "fix-login",
    name: "fix/login",
    branch: "fix/login",
    localPath: "/work/widgets/.worktrees/fix-login",
  },
  {
    ...workspace,
    id: "wsp_search",
    projectId: widgets.id,
    slug: "feature-search",
    name: "feature/search",
    branch: "feature/search",
    localPath: "/home/exeora/widgets",
    deviceId: "dev_cloud_search",
    cloud: true,
    machine: "widgets-feature-search",
  },
  {
    ...workspace,
    id: "wsp_billing",
    projectId: widgets.id,
    slug: "feature-billing",
    name: "feature/billing",
    branch: "feature/billing",
    localPath: "/home/exeora/widgets",
    deviceId: "dev_cloud_billing",
    cloud: true,
    machine: "widgets-feature-billing",
  },
];

export function instance(patch: Record<string, unknown> = {}) {
  return {
    deviceId: "dev_cloud_root",
    kind: "cloud",
    name: "widgets-main",
    platform: "linux",
    cliVersion: "0.18.0",
    online: false,
    state: "asleep",
    lastSeenAt: now - 3_600_000,
    createdAt: now - 86_400_000,
    revokedAt: null,
    project: { id: widgets.id, slug: widgets.slug, name: widgets.name },
    workspace: { id: null as string | null, slug: "main", branch: "master" },
    status: "ready",
    step: null as string | null,
    error: null as string | null,
    errorCode: null as string | null,
    errorDetail: null as string | null,
    readyAt: now - 86_000_000,
    runtime: "cold" as string | null,
    ...patch,
  };
}

export const desktop = {
  ...laptop,
  deviceId: "dev_desktop",
  name: "Desktop",
  platform: "macos",
  projects: [
    {
      projectId: widgets.id,
      slug: widgets.slug,
      name: widgets.name,
      localPath: null,
      status: "pending",
      error: null,
      default: false,
      workspaces: 0,
    },
  ],
};

/** Every machine of the account that holds `widgets` and `project`. */
export const machines = [
  {
    ...laptop,
    projects: [
      ...laptop.projects,
      {
        projectId: widgets.id,
        slug: widgets.slug,
        name: widgets.name,
        localPath: "/work/widgets",
        status: "ready",
        error: null,
        default: true,
        workspaces: 1,
      },
    ],
  },
  desktop,
  instance(),
  instance({
    deviceId: "dev_cloud_search",
    name: "widgets-feature-search",
    online: true,
    state: "online",
    lastSeenAt: now,
    workspace: { id: "wsp_search", slug: "feature-search", branch: "feature/search" },
    runtime: "running",
  }),
  instance({
    deviceId: "dev_cloud_billing",
    name: "widgets-feature-billing",
    state: "failed",
    status: "error",
    lastSeenAt: null,
    readyAt: null,
    workspace: { id: "wsp_billing", slug: "feature-billing", branch: "feature/billing" },
    error: "The instance could not be set up. Retry, and check the details if it fails again.",
    errorCode: "setup_failed",
    errorDetail: "The CLI never connected. The service wrote no log.",
    runtime: null,
  }),
];

export const github = {
  enabled: true,
  connected: true,
  installations: [
    {
      id: "ghi_101",
      installationId: 101,
      accountLogin: "example",
      accountType: "Organization",
      repositorySelection: "selected",
      suspended: false,
      manageUrl: "https://github.com/organizations/example/settings/installations/101",
    },
  ],
  connectUrl: "https://github.com/apps/exeora/installations/new?state=signed",
};

export const githubOff = { enabled: false, connected: false, installations: [], connectUrl: null };

export const repositories = [
  {
    id: 9001,
    fullName: "example/gadgets",
    owner: "example",
    name: "gadgets",
    private: true,
    defaultBranch: "trunk",
    url: "https://github.com/example/gadgets.git",
    description: null,
    pushedAt: now - 60_000,
    installationId: 101,
    projectId: null as string | null,
  },
  {
    id: 9002,
    fullName: "example/widgets",
    owner: "example",
    name: "widgets",
    private: false,
    defaultBranch: "master",
    url: "https://github.com/example/widgets.git",
    description: null,
    pushedAt: now - 120_000,
    installationId: 101,
    projectId: widgets.id,
  },
];

export function accountClient(patch: Record<string, unknown> = {}) {
  return {
    clientId: "client_chatgpt",
    clientName: "ChatGPT",
    clientUri: null,
    mcpName: null,
    mcpVersion: null,
    authorizedAt: now,
    lastUsedAt: null,
    allProjects: false,
    projects: [{ id: "pcl_1", projectId: widgets.id, revokedAt: null }] as Array<{
      id: string;
      projectId: string;
      revokedAt: number | null;
    }>,
    ...patch,
  };
}
