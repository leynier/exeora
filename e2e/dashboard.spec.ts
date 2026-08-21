import { expect, type Page, type Request, test } from "@playwright/test";

const user = {
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

const project = {
  id: "prj_e2e",
  slug: "e2e",
  name: "E2E project",
  deviceId: "dev_e2e",
  localPath: "/work/e2e",
  mcpUrl: "https://exeora.test/p/prj_e2e/mcp",
  policy: { mode: "allow_all", allow: [], deny: [], shell: true, approve: false, tools: null },
  createdAt: Date.now(),
};

const worktree = {
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

function gitStatus(target: "main" | "worktree") {
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
        name: "origin/main",
        shortOid: "abc111",
        upstream: null,
        remote: true,
        current: false,
      },
    ],
    remotes: ["origin"],
  };
}

function applyWorkspaceAction(
  status: ReturnType<typeof gitStatus>,
  action: { action?: string; paths?: string[] },
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
  return status;
}

async function signedIn(page: Page) {
  await page.addInitScript(() => {
    if (!window.location.pathname.startsWith("/dashboard")) return;
    sessionStorage.setItem("exeora.access_token", "e2e-token");
    sessionStorage.setItem("exeora.expires_at", String(Date.now() + 3_600_000));
  });
}

async function mockApi(
  page: Page,
  options: { failDevices?: () => boolean; onRequest?: (request: Request) => void } = {},
) {
  const state = {
    main: gitStatus("main"),
    worktree: gitStatus("worktree"),
  };
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
      "/api/projects": [project],
      "/api/clients": [],
      "/api/tool-calls": { items: [], cursor: null },
      "/api/approvals": { items: [] },
      [`/api/projects/${project.id}/worktrees`]: [worktree],
    };
    const body = bodies[path];
    if (body !== undefined) {
      await route.fulfill({ status: 200, json: body });
      return;
    }

    const workspace = `/api/projects/${project.id}/workspace`;
    const target = url.searchParams.get("worktree") === worktree.id ? "worktree" : "main";
    if (path === `${workspace}/capabilities`) {
      await route.fulfill({
        status: 200,
        json: { online: true, sourceControl: true, terminal: true, worktreeRouting: true },
      });
      return;
    }
    if (path === `${workspace}/status`) {
      await route.fulfill({ status: 200, json: state[target] });
      return;
    }
    if (path === `${workspace}/diff`) {
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
    if (path === `${workspace}/actions`) {
      const action = request.postDataJSON() as { action?: string; paths?: string[] };
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

test("distinguishes a failed query from an empty account and retries it", async ({ page }) => {
  let failDevices = true;
  await signedIn(page);
  await mockApi(page, { failDevices: () => failDevices });
  await page.goto("/dashboard/");

  await expect(page.getByRole("alert")).toContainText("Could not load this data");
  await expect(page.getByText("Nothing is connected yet.")).toHaveCount(0);

  failDevices = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Nothing is connected yet.")).toBeVisible();
});

test("sign out clears the tab token and reaches the server logout endpoint", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.route("**/oauth/logout", (route) =>
    route.fulfill({ status: 200, body: "signed out" }),
  );
  await page.goto("/dashboard/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/oauth/logout");
  expect(await page.evaluate(() => sessionStorage.getItem("exeora.access_token"))).toBeNull();
});

test("clipboard denial is visible on the project list", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Projects" }).click();

  await page.getByRole("button", { name: "Copy URL" }).click();
  await expect(page.getByRole("alert")).toContainText("Clipboard access was refused");
  await expect(page.getByRole("button", { name: "Copy failed" })).toBeVisible();
});

test("opens workspace from the tab with custom project and worktree dropdowns", async ({
  page,
}) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Project ${project.name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Worktree main" })).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();

  await page.getByRole("button", { name: "Worktree main" }).click();
  await page.getByRole("option", { name: /feature-trees/ }).click();
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toBeVisible();
});

test("keeps source control and terminal bound to the selected worktree", async ({ page }) => {
  const requests: Request[] = [];
  await signedIn(page);
  await mockApi(page, { onRequest: (request) => requests.push(request) });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("link", { name: project.name }).click();
  await expect(page.getByText(worktree.name, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open workspace" }).nth(1).click();
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );

  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Worktree ${worktree.slug}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Current branch feature/trees" })).toBeVisible();
  const featureFile = page.getByRole("button", { name: /feature-tree\.txt/ });
  await expect(featureFile).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toHaveCount(0);

  await featureFile.hover();
  await page.getByRole("button", { name: "Stage", exact: true }).click();
  await expect
    .poll(() =>
      requests.some((request) => {
        const url = new URL(request.url());
        return (
          request.method() === "POST" &&
          url.pathname.endsWith("/workspace/actions") &&
          url.searchParams.get("worktree") === worktree.id
        );
      }),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Terminal" }).click();
  await expect(page.getByText("Start an interactive shell in feature-trees")).toBeVisible();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Commands run directly on your connected machine in feature-trees",
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: `Worktree ${worktree.slug}` }).click();
  await page.getByRole("option", { name: /^main/ }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: "Source Control" }).click();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toHaveCount(0);
});

test("redirects legacy project workspace URLs onto the workspace tab", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await expect(page.getByRole("link", { name: "Workspace", exact: true })).toBeVisible();
  await page.evaluate((href) => {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `/dashboard/projects/${project.id}/workspace?worktree=${worktree.slug}`);
  await expect(page).toHaveURL(
    `/dashboard/workspace?project=${project.id}&worktree=${worktree.slug}`,
  );
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toBeVisible();
});

test("places Workspace after Activity in the shell nav", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  const labels = await page.locator("header nav a").allTextContents();
  expect(labels.indexOf("Activity")).toBeGreaterThan(-1);
  expect(labels.indexOf("Workspace")).toBeGreaterThan(labels.indexOf("Activity"));
});

test("stage all moves working-tree files into staged", async ({ page }) => {
  const staged: string[][] = [];
  await signedIn(page);
  await mockApi(page, {
    onRequest: (request) => {
      if (request.method() !== "POST" || !request.url().includes("/workspace/actions")) return;
      const body = request.postDataJSON() as { action?: string; paths?: string[] };
      if (body.action === "stage") staged.push(body.paths ?? []);
    },
  });
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\.md/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /changes/i })).toContainText("2");

  await page.getByRole("button", { name: "Stage all" }).click();
  await expect.poll(() => staged.at(-1)?.slice().sort()).toEqual(["main.txt", "notes.md"].sort());
  await expect(page.getByRole("heading", { name: /staged/i })).toContainText("2");
  await expect(page.getByRole("heading", { name: /changes/i })).toContainText("0");
  await expect(page.getByRole("button", { name: "Unstage all" })).toBeVisible();
});

test("switches branches from the toolbar picker", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await page.goto("/dashboard/");
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: "Current branch main" }).click();
  await expect(page.getByRole("option", { name: /feature\/trees/ })).toBeVisible();
  await expect(page.getByPlaceholder("Find or create a branch")).toBeVisible();
  await page.getByRole("option", { name: /origin\/main/ }).click();
});
