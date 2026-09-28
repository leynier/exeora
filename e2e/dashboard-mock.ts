import type { Page, Request } from "@playwright/test";

import {
  accountClient,
  githubOff,
  laptop,
  otherProject,
  project,
  user,
  workspace,
} from "./fixtures.js";

export { otherProject, project, user, workspace };

export function gitStatus(target: "main" | "workspace") {
  const feature = target === "workspace";
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
    gitWorkspaces: [
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
    failMachines?: () => boolean;
    onRequest?: (request: Request) => void;
    statusDelay?: (requestNumber: number) => number;
    statusHead?: (requestNumber: number) => string | undefined;
    projects?: Array<typeof project>;
    terminals?: Array<{
      sessionId: string;
      projectId: string;
      workspaceId?: string;
      workspaceSlug?: string;
      startedAt: number;
    }>;
  } = {},
) {
  const state = {
    main: gitStatus("main"),
    workspace: gitStatus("workspace"),
    // The root of another location: a different machine, with a different
    // folder and whatever branch happens to be checked out there.
    elsewhere: {
      ...gitStatus("main"),
      head: "release",
      upstream: "origin/release",
      files: [
        { path: "desktop.txt", index: ".", worktree: "M", kind: "tracked", submodule: false },
      ],
      branches: [
        {
          name: "release",
          shortOid: "rel123",
          upstream: "origin/release",
          remote: false,
          current: true,
        },
      ],
      gitWorkspaces: [{ path: "/srv/e2e", branch: "release" }],
    },
  };
  const listed = options.projects ?? [project];
  const connectedWorkspaces = [workspace];
  let statusRequests = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    options.onRequest?.(request);
    if (path === "/api/machines" && options.failMachines?.()) {
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
      return;
    }

    const bodies: Record<string, unknown> = {
      "/api/me": user,
      "/api/machines": { machines: listed.length > 0 ? [laptop] : [] },
      "/api/projects": listed,
      "/api/clients": [],
      "/api/account-clients": [accountClient({ allProjects: true, projects: [] })],
      "/api/github": githubOff,
      "/api/tool-calls": { items: [], cursor: null },
      "/api/approvals": { items: [] },
      "/api/terminals": { items: options.terminals ?? [] },
      [`/api/projects/${project.id}/workspaces`]: connectedWorkspaces,
      [`/api/projects/${otherProject.id}/workspaces`]: [],
    };
    const body = request.method() === "GET" ? bodies[path] : undefined;
    if (body !== undefined) {
      await route.fulfill({ status: 200, json: body });
      return;
    }

    if (path.endsWith("/terminal-ticket")) {
      await new Promise(() => {});
      return;
    }
    if (path.endsWith("/logs-ticket")) {
      // A socket the spec answers with `page.routeWebSocket`.
      const socket = new URL("/logs/connect", url.origin);
      socket.searchParams.set("projectId", path.split("/")[3] ?? "");
      const target = url.searchParams.get("workspace");
      if (target) socket.searchParams.set("workspace", target);
      await route.fulfill({ status: 200, json: { url: socket.toString(), expiresInMs: 30_000 } });
      return;
    }
    const asked = url.searchParams.get("workspace");
    const target =
      asked === workspace.id ? "workspace" : asked?.startsWith("main@") ? "elsewhere" : "main";
    if (path.endsWith("/workspace/capabilities")) {
      await route.fulfill({
        status: 200,
        json: {
          online: true,
          sourceControl: true,
          sourceControlV2: false,
          files: false,
          search: false,
          terminal: true,
          workspaceRouting: true,
        },
      });
      return;
    }
    if (path.endsWith("/workspace/status")) {
      statusRequests += 1;
      const response = structuredClone(state[target]);
      response.head = options.statusHead?.(statusRequests) ?? response.head;
      const delay = options.statusDelay?.(statusRequests) ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      await route.fulfill({ status: 200, json: response });
      return;
    }
    if (path.endsWith("/workspace/diff")) {
      const requested = url.searchParams.get("path");
      const file = requested ?? (target === "workspace" ? "feature-tree.txt" : "main.txt");
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
    // What the gateway answers a new workspace with. The slug is its own to
    // choose, so the one it sends back is not the one that was asked for.
    if (request.method() === "POST" && path === `/api/projects/${project.id}/workspaces`) {
      const asked = request.postDataJSON() as { branch: string; where?: string };
      const created = {
        ...workspace,
        id: "wsp_created",
        slug: `${asked.branch}-laptop`,
        name: asked.branch,
        branch: asked.branch,
        localPath: `/work/e2e/.worktrees/${asked.branch}-laptop`,
      };
      connectedWorkspaces.push(created);
      await route.fulfill({
        status: 201,
        json: { workspace: created, where: asked.where ?? "laptop", status: "ready" },
      });
      return;
    }
    if (path.endsWith("/workspace/actions")) {
      const action = request.postDataJSON() as {
        action?: string;
        paths?: string[];
        name?: string;
        remoteBranch?: string;
      };
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
