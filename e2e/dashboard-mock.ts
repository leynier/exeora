import type { Page, Request } from "@playwright/test";

export const user = {
  id: "usr_e2e",
  email: "e2e@example.com",
  name: "E2E User",
  avatarUrl: null,
  plan: "free",
  isAdmin: false,
  accountMcpUrl: "https://exeora.test/mcp",
  limits: { maxDevices: 2, maxProjects: 3, retentionDays: 90 },
  usage: { devices: 0, projects: 1, toolCallsMonth: 0 },
};

export const project = {
  id: "prj_e2e",
  slug: "e2e",
  name: "E2E project",
  deviceId: "dev_e2e",
  localPath: "/work/e2e",
  mcpUrl: "https://exeora.test/p/prj_e2e/mcp",
  policy: { mode: "allow_all", allow: [], deny: [], shell: true, approve: false, tools: null },
  createdAt: Date.now(),
};

export const otherProject = {
  ...project,
  id: "prj_other",
  slug: "other",
  name: "Other project",
  localPath: "/work/other",
  mcpUrl: "https://exeora.test/p/prj_other/mcp",
};

export const worktree = {
  id: "wtr_feature",
  projectId: project.id,
  slug: "feature-trees",
  name: "Feature trees",
  branch: "feature/trees",
  localPath: "/work/e2e/.worktrees/feature-trees",
  managed: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export function gitStatus(target: "main" | "worktree") {
  const feature = target === "worktree";
  return {
    kind: "status",
    repository: true,
    head: feature ? "feature/trees" : "main",
    oid: feature ? "feature123" : "main123",
    upstream: feature ? "origin/feature/trees" : "origin/main",
    ahead: 0,
    behind: 0,
    operation: null,
    files: feature
      ? [
          {
            path: "feature-tree.txt",
            index: ".",
            worktree: "M",
            kind: "tracked",
            submodule: false,
          },
        ]
      : [
          {
            path: "main.txt",
            index: ".",
            worktree: "M",
            kind: "tracked",
            submodule: false,
          },
          {
            path: "notes.md",
            index: ".",
            worktree: "M",
            kind: "tracked",
            submodule: false,
          },
        ],
    branches: [
      {
        name: feature ? "feature/trees" : "main",
        shortOid: feature ? "feature" : "main123",
        upstream: feature ? "origin/feature/trees" : "origin/main",
        remote: false,
        current: true,
      },
      {
        name: feature ? "main" : "feature/trees",
        shortOid: feature ? "main123" : "feature",
        upstream: null,
        remote: false,
        current: false,
      },
      {
        name: "experiment",
        shortOid: "exp123",
        upstream: null,
        remote: false,
        current: false,
      },
      {
        name: "origin/main",
        shortOid: "abc111",
        upstream: null,
        remote: true,
        current: false,
      },
    ],
    remotes: ["origin"],
    gitWorktrees: [
      { path: "/work/e2e", branch: "main" },
      { path: "/work/e2e/.worktrees/feature-trees", branch: "feature/trees" },
    ],
  };
}

function applyWorkspaceAction(
  status: ReturnType<typeof gitStatus>,
  action: { action?: string; paths?: string[]; name?: string; remoteBranch?: string },
) {
  if (action.action === "stage" && Array.isArray(action.paths)) {
    return {
      ...status,
      files: status.files.map((file) => {
        if (!action.paths?.includes(file.path)) return file;
        return {
          ...file,
          index: file.kind === "untracked" || file.index === "?" ? "A" : file.worktree,
          worktree: ".",
          kind: "tracked" as const,
        };
      }),
    };
  }
  if (action.action === "unstage" && Array.isArray(action.paths)) {
    return {
      ...status,
      files: status.files.map((file) => {
        if (!action.paths?.includes(file.path)) return file;
        const added = file.index === "A";
        return {
          ...file,
          index: ".",
          worktree: added ? "?" : file.index,
          kind: added ? ("untracked" as const) : file.kind,
        };
      }),
    };
  }
  if (action.action === "branch_switch" && action.name) {
    return {
      ...status,
      head: action.name,
      branches: status.branches.map((branch) => ({
        ...branch,
        current: !branch.remote && branch.name === action.name,
      })),
    };
  }
  if (action.action === "branch_create" && action.name) {
    return {
      ...status,
      head: action.name,
      branches: [
        ...status.branches.map((branch) => ({ ...branch, current: false })),
        {
          name: action.name,
          shortOid: "new",
          upstream: null,
          remote: false,
          current: true,
        },
      ],
    };
  }
  if (action.action === "branch_track" && action.name) {
    const exists = status.branches.some((branch) => !branch.remote && branch.name === action.name);
    return {
      ...status,
      head: action.name,
      branches: [
        ...status.branches.map((branch) => ({
          ...branch,
          current: !branch.remote && branch.name === action.name,
        })),
        ...(exists
          ? []
          : [
              {
                name: action.name,
                shortOid: "new",
                upstream: action.remoteBranch ?? null,
                remote: false,
                current: true,
              },
            ]),
      ],
    };
  }
  return status;
}

export async function signedIn(page: Page) {
  await page.addInitScript(() => {
    if (!window.location.pathname.startsWith("/dashboard")) return;
    sessionStorage.setItem("exeora.access_token", "e2e-token");
    sessionStorage.setItem("exeora.expires_at", String(Date.now() + 3_600_000));
  });
}

/** Preview only has /dashboard/index.html, so client routes are pushed. */
export async function openWorkspace(page: Page, href: string) {
  await page.goto("/dashboard/");
  await page.evaluate((next) => {
    window.history.pushState({}, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href);
}

export async function mockApi(
  page: Page,
  options: {
    failDevices?: () => boolean;
    onRequest?: (request: Request) => void;
    projects?: Array<typeof project>;
    terminals?: Array<{
      sessionId: string;
      projectId: string;
      worktreeId?: string;
      worktreeSlug?: string;
      startedAt: number;
    }>;
  } = {},
) {
  const state = {
    main: gitStatus("main"),
    worktree: gitStatus("worktree"),
  };
  const listed = options.projects ?? [project];
  const connectedWorktrees = [worktree];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    options.onRequest?.(request);
    if (path === "/api/devices" && options.failDevices?.()) {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
      return;
    }

    const bodies: Record<string, unknown> = {
      "/api/me": user,
      "/api/devices": [],
      "/api/projects": listed,
      "/api/clients": [],
      "/api/tool-calls": { items: [], cursor: null },
      "/api/approvals": { items: [] },
      "/api/terminals": { items: options.terminals ?? [] },
      [`/api/projects/${project.id}/worktrees`]: connectedWorktrees,
      [`/api/projects/${otherProject.id}/worktrees`]: [],
    };
    const body = bodies[path];
    if (body !== undefined) {
      await route.fulfill({ status: 200, json: body });
      return;
    }

    if (path.endsWith("/terminal-ticket")) {
      await new Promise(() => {});
      return;
    }
    const target = url.searchParams.get("worktree") === worktree.id ? "worktree" : "main";
    if (path.endsWith("/workspace/capabilities")) {
      await route.fulfill({
        status: 200,
        json: { online: true, sourceControl: true, terminal: true, worktreeRouting: true },
      });
      return;
    }
    if (path.endsWith("/workspace/status")) {
      await route.fulfill({ status: 200, json: state[target] });
      return;
    }
    if (path.endsWith("/workspace/diff")) {
      const requested = url.searchParams.get("path");
      const file = requested ?? (target === "worktree" ? "feature-tree.txt" : "main.txt");
      const area = url.searchParams.get("area") ?? "working";
      await route.fulfill({
        status: 200,
        json: {
          kind: "diff",
          path: file,
          area,
          patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new`,
          binary: false,
          truncated: false,
        },
      });
      return;
    }
    if (path.endsWith("/workspace/actions")) {
      const action = request.postDataJSON() as {
        action?: string;
        paths?: string[];
        name?: string;
        branch?: string;
        remoteBranch?: string;
      };
      if (action.action === "worktree_create" && action.branch) {
        const created = {
          id: "wtr_created",
          projectId: project.id,
          slug: "from-source-control",
          name: action.branch,
          branch: action.branch,
          localPath: "/work/e2e/.worktrees/from-source-control",
          managed: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        connectedWorktrees.push(created);
        await route.fulfill({
          status: 200,
          json: {
            kind: "mutation",
            stdout: "",
            stderr: "",
            status: state[target],
            worktree: created,
          },
        });
        return;
      }
      state[target] = applyWorkspaceAction(state[target], action);
      await route.fulfill({
        status: 200,
        json: { kind: "mutation", stdout: "", stderr: "", status: state[target] },
      });
      return;
    }

    await route.fulfill({ status: 404 });
  });
}
