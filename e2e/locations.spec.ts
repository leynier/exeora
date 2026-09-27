import { expect, type Request, test } from "@playwright/test";
import { mockApi, openWorkspace, project, signedIn } from "./dashboard-mock.js";
import { location, widgets, widgetsWorkspaces } from "./fixtures.js";
import { mockPlaces } from "./places-mock.js";

/** The small project, on the laptop and on a desktop that has cloned it too. */
const twoMachines = {
  ...project,
  locations: [
    ...project.locations,
    location({
      id: "loc_desktop",
      deviceId: "dev_desktop",
      name: "Desktop",
      slug: "desktop",
      localPath: "/srv/e2e",
      default: false,
    }),
  ],
};

const asked = (requests: Request[], suffix: string) =>
  requests
    .map((request) => new URL(request.url()))
    .filter((url) => url.pathname.endsWith(suffix))
    .map((url) => url.searchParams.get("workspace"));

test("opens the root of a location that is not the default", async ({ page }) => {
  const requests: Request[] = [];
  await signedIn(page);
  await mockApi(page, {
    projects: [twoMachines],
    onRequest: (request) => requests.push(request),
  });
  await openWorkspace(page, `/dashboard/projects/${project.id}`);

  const desktop = page.getByRole("region", { name: "Desktop", exact: true });
  await expect(desktop.getByText("main", { exact: true })).toBeVisible();
  await desktop.getByRole("link", { name: "Open workspace" }).click();

  await expect(page).toHaveURL(/\/dashboard\/workspace\?/);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe("main@desktop");
  // Named by where it is in the selector, and by its real branch in the toolbar.
  await expect(page.getByRole("button", { name: "Workspace root · Desktop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Current branch release" })).toBeVisible();
  await expect(page.getByRole("button", { name: /desktop\.txt/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /main\.txt/ })).toHaveCount(0);
  await expect(page.getByText("Desktop · /srv/e2e")).toBeVisible();

  expect(asked(requests, "/workspace/status")).toContain("main@desktop");
  expect(asked(requests, "/workspace/capabilities")).toContain("main@desktop");
  // Nothing was asked of the default location's root on the way.
  expect(asked(requests, "/workspace/status")).not.toContain(null);

  await page.getByRole("button", { name: /desktop\.txt/ }).hover();
  await page.getByRole("button", { name: "Stage", exact: true }).click();
  await expect.poll(() => asked(requests, "/workspace/actions")).toEqual(["main@desktop"]);
});

test("keeps the terminal of another location's root apart from the default one's", async ({
  page,
}) => {
  const requests: Request[] = [];
  await signedIn(page);
  await mockApi(page, {
    projects: [twoMachines],
    onRequest: (request) => requests.push(request),
  });
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&workspace=main@desktop&view=terminal`,
  );

  await expect(page.getByText("Start an interactive shell in root · Desktop.")).toBeVisible();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open terminal" }).click();
  const chip = page.getByRole("button", { name: "E2E project / root · Desktop" });
  await expect(chip).toBeVisible();
  await expect.poll(() => asked(requests, "/terminal-ticket")).toEqual(["main@desktop"]);

  // The default location's root is another working copy, with a terminal of
  // its own to open: the one on the desktop is not taken for it.
  await page.getByRole("button", { name: "Workspace root · Desktop" }).click();
  await page.getByRole("option", { name: "main · default branch · Laptop" }).click();
  expect(new URL(page.url()).searchParams.get("workspace")).toBeNull();
  await expect(
    page.getByText("Start an interactive shell in main · default branch."),
  ).toBeVisible();
  await expect(chip).toBeVisible();

  await chip.click();
  expect(new URL(page.url()).searchParams.get("workspace")).toBe("main@desktop");

  await page.getByRole("button", { name: "Close terminal root · Desktop" }).click();
  await expect
    .poll(() =>
      requests
        .filter((request) => request.method() === "DELETE")
        .map((request) => new URL(request.url()).searchParams.get("workspace")),
    )
    .toEqual(["main@desktop"]);
});

test("lists a terminal that outlived a reload under the root it is in", async ({ page }) => {
  await signedIn(page);
  await mockApi(page, {
    projects: [twoMachines],
    terminals: [
      { sessionId: "term_default", projectId: project.id, startedAt: Date.now() },
      {
        sessionId: "term_desktop",
        projectId: project.id,
        workspaceSlug: "main@desktop",
        startedAt: Date.now(),
      },
      // The default location's root, named the long way. It is the same
      // working copy as the first, and is not listed twice.
      {
        sessionId: "term_again",
        projectId: project.id,
        workspaceSlug: "main@laptop",
        startedAt: Date.now(),
      },
    ],
  });
  await page.goto("/dashboard/");

  await expect(page.getByRole("button", { name: /^E2E project \// })).toHaveText([
    "E2E project / main · default branch",
    "E2E project / root · Desktop",
  ]);
});

test("says what is missing for a root that cannot be opened", async ({ page }) => {
  await signedIn(page);
  await mockApi(page, {
    projects: [
      {
        ...twoMachines,
        locations: twoMachines.locations.map((entry) =>
          entry.slug === "desktop"
            ? { ...entry, localPath: null, status: "pending", state: "not cloned" }
            : entry,
        ),
      },
    ],
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&workspace=main@desktop`);

  await expect(page.getByText("Desktop holds no copy of the project yet.")).toBeVisible();
  // A location with no copy has no root to choose either.
  await page.getByRole("button", { name: /^Workspace/ }).click();
  await expect(page.getByRole("option", { name: /Desktop/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The address that names the default root the long way is the default root.
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&workspace=main@laptop`);
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("workspace")).toBeNull();
});

test("says where each call in the activity log ran", async ({ page }) => {
  const call = (id: string, patch: Record<string, unknown>) => ({
    id,
    projectId: widgets.id,
    workspaceId: null,
    workspaceSlug: null,
    tool: "read_file",
    status: "ok",
    durationMs: 12,
    errorCode: null,
    clientId: "client_chatgpt",
    clientName: "ChatGPT",
    createdAt: Date.now(),
    ...patch,
  });
  const fetched: string[] = [];
  await signedIn(page);
  await mockPlaces(page, {
    calls: [
      call("call_root", { tool: "run_command", workspaceSlug: "main@desktop" }),
      call("call_workspace", { workspaceId: "wsp_login", workspaceSlug: "fix-login" }),
      call("call_instance", { workspaceId: "wsp_search", workspaceSlug: "feature-search" }),
      call("call_gone_location", { workspaceSlug: "main@old-box" }),
      call("call_gone_workspace", { workspaceId: "wsp_gone", workspaceSlug: "was-here" }),
      call("call_old", {}),
      // A project whose only call ran in a root has nothing to be asked.
      call("call_other", { projectId: project.id, workspaceSlug: "main@laptop" }),
    ],
    workspaces: { [widgets.id]: widgetsWorkspaces, [project.id]: [] },
    handle: (_route, request, path) => {
      if (request.method() === "GET" && path.endsWith("/workspaces")) fetched.push(path);
      return false;
    },
  });
  await openWorkspace(page, "/dashboard/activity");

  const rows = page.locator("main p").filter({ hasText: " / " });
  await expect(rows).toHaveText([
    "Widgets / master · default branch · Desktop · ChatGPT",
    "Widgets / fix/login · Laptop · ChatGPT",
    "Widgets / feature/search · Exeora Cloud · ChatGPT",
    "Widgets / master · default branch · old-box · ChatGPT",
    "Widgets / was-here · ChatGPT",
    "Widgets / master · default branch · ChatGPT",
    "E2E project / main · default branch · Laptop · ChatGPT",
  ]);
  // One request for the project with calls in workspaces, however many rows
  // it has, and none for the one whose calls say where they ran by themselves.
  expect(fetched).toEqual([`/api/projects/${widgets.id}/workspaces`]);
});

test("says where the recent calls ran on the overview and on the project", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, {
    calls: [
      {
        id: "call_root",
        projectId: widgets.id,
        workspaceId: null,
        workspaceSlug: "main@cloud",
        tool: "run_command",
        status: "ok",
        durationMs: 12,
        errorCode: null,
        clientId: null,
        clientName: null,
        createdAt: Date.now(),
      },
      {
        id: "call_workspace",
        projectId: widgets.id,
        workspaceId: "wsp_login",
        workspaceSlug: "fix-login",
        tool: "read_file",
        status: "ok",
        durationMs: 12,
        errorCode: null,
        clientId: null,
        clientName: null,
        createdAt: Date.now(),
      },
    ],
  });
  await page.goto("/dashboard/");

  const recent = page.locator("section").filter({ hasText: "Recent activity" });
  await expect(recent.getByText("Widgets / master · default branch · Exeora Cloud")).toBeVisible();
  await expect(recent.getByText("Widgets / fix/login · Laptop")).toBeVisible();

  await openWorkspace(page, `/dashboard/projects/${widgets.id}`);
  const activity = page.locator("section").filter({ hasText: "Recent activity" });
  await expect(activity.getByText("master · default branch · Exeora Cloud")).toBeVisible();
  await expect(activity.getByText("fix/login · Laptop")).toBeVisible();
});
