import { expect, type Page, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { accountClient, cloudUser, githubOff, widgets } from "./fixtures.js";
import { mockPlaces } from "./places-mock.js";

const detail = `/dashboard/projects/${widgets.id}`;

/** The block of one location on the project's page. */
const block = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("lists each project with its locations and nothing to remove it with", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, "/dashboard/projects");

  const card = page.getByRole("article").filter({ hasText: "Widgets" });
  await expect(card.getByRole("link", { name: "Widgets" })).toBeVisible();
  await expect(card.getByText("github.com/example/widgets")).toBeVisible();
  await expect(card.getByText("private")).toHaveCount(1);
  await expect(card.getByText("3 workspaces")).toBeVisible();

  const chips = card.getByRole("list", { name: "Locations of Widgets" }).getByRole("listitem");
  await expect(chips).toHaveCount(3);
  // The state is a word for whoever cannot see the dot, and the default is marked.
  await expect(chips.nth(0)).toHaveText("onlineLaptopdefault");
  await expect(chips.nth(1)).toHaveText("not clonedDesktop");
  await expect(chips.nth(2)).toHaveText("asleepExeora Cloud");

  // Removing a project is done from its own page and nowhere else.
  await expect(page.getByRole("button", { name: /remove/i })).toHaveCount(0);
  // An account with a client on the account URL has the card folded to a line.
  await expect(page.getByText("One URL for everything")).toBeVisible();
  await expect(page.getByText(cloudUser.accountMcpUrl, { exact: true })).toBeHidden();
});

test("groups workspaces under their locations, the root named by its branch", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, detail);

  await expect(page.getByRole("heading", { name: "Widgets", level: 1 })).toBeVisible();
  await expect(page.getByText("github.com/example/widgets")).toBeVisible();

  const laptop = block(page, "Laptop");
  await expect(laptop.getByRole("heading", { name: "Laptop" })).toBeVisible();
  await expect(laptop.getByText("online", { exact: true })).toBeVisible();
  // `master`, because that is the branch, and never `main` or "project root".
  await expect(laptop.getByText("master", { exact: true })).toBeVisible();
  await expect(laptop.getByText("default", { exact: true })).toHaveCount(2);
  await expect(laptop.getByText("fix/login", { exact: true })).toBeVisible();
  await expect(laptop.getByText("feature/search")).toHaveCount(0);

  const desktop = block(page, "Desktop");
  await expect(desktop.getByText("not cloned")).toBeVisible();
  await expect(
    desktop.getByText("The repository is cloned here when the first workspace is made."),
  ).toBeVisible();

  const cloud = block(page, "Exeora Cloud");
  await expect(cloud.getByText("feature/search", { exact: true })).toBeVisible();
  await expect(cloud.getByText("feature/billing", { exact: true })).toBeVisible();
  await expect(cloud.getByText("failed", { exact: true })).toBeVisible();
  await expect(cloud.getByText("The instance could not be set up.")).toBeVisible();
  await expect(cloud.getByRole("button", { name: "Retry" })).toBeVisible();
  // The root of a location that is not the default is a copy nothing reaches.
  await expect(cloud.getByText("Make this location the default to open this copy.")).toBeVisible();

  await expect(page.getByText(/project root|primary checkout/i)).toHaveCount(0);
});

test("adds a workspace where it was asked for", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, detail);

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a workspace" });
  await dialog.getByLabel("Branch", { exact: true }).fill("feature/export");
  await expect(dialog.getByLabel("Start from")).toHaveAttribute("placeholder", "master");
  // The default location arrives chosen.
  await expect(dialog.getByRole("button", { name: "Where" })).toContainText("Laptop");

  // Each location is listed with its state, and says what choosing it does.
  await dialog.getByRole("button", { name: "Where" }).click();
  await expect(dialog.getByRole("option", { name: "Laptop · online · default" })).toBeVisible();
  await expect(dialog.getByRole("option", { name: "Desktop · not cloned" })).toBeVisible();
  await dialog.getByRole("option", { name: "Exeora Cloud · asleep" }).click();
  await expect(dialog.getByText("3 of 10 in use")).toBeVisible();
  await dialog.getByRole("button", { name: "Add workspace" }).click();

  await expect(page.getByRole("status")).toContainText("Setting up an instance for feature/export");
  expect(sent).toEqual([
    {
      method: "POST",
      path: `/api/projects/${widgets.id}/workspaces`,
      body: { branch: "feature/export", where: "cloud" },
    },
  ]);
});

test("says a clone is running and keeps the dialog open until it answers", async ({ page }) => {
  let answer: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await signedIn(page);
  await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (request.method() !== "POST" || !path.endsWith("/workspaces")) return false;
      await held;
      await route.fulfill({
        status: 409,
        json: { error: "TOOL_TIMEOUT", message: "The clone is still running on Desktop." },
      });
      return true;
    },
  });
  await openWorkspace(page, detail);

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a workspace" });
  await dialog.getByLabel("Branch", { exact: true }).fill("feature/export");
  await dialog.getByRole("button", { name: "Where" }).click();
  await dialog.getByRole("option", { name: /Desktop/ }).click();
  await expect(dialog.getByText("the repository is cloned there first")).toBeVisible();
  await dialog.getByRole("button", { name: "Add workspace" }).click();

  await expect(dialog.getByRole("status")).toHaveText("Cloning the repository on Desktop…");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  answer();
  // The refusal is said where it can be acted on, in the gateway's words.
  await expect(dialog.getByRole("alert")).toHaveText("The clone is still running on Desktop.");
});

test("refuses a machine that is offline before the gateway has to", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    projects: [
      {
        ...widgets,
        locations: widgets.locations.map((entry) =>
          entry.slug === "desktop" ? { ...entry, online: false, state: "offline" } : entry,
        ),
      },
    ],
  });
  await openWorkspace(page, detail);

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a workspace" });
  await dialog.getByLabel("Branch", { exact: true }).fill("feature/export");
  await dialog.getByRole("button", { name: "Where" }).click();
  await dialog.getByRole("option", { name: /Desktop/ }).click();

  await expect(dialog.getByText("Desktop is offline. Run `exeora connect` on it")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add workspace" })).toBeDisabled();
  expect(sent).toEqual([]);
});

test("offers to remove a workspace anyway only after it was refused", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (!path.endsWith("/remove")) return false;
      if ((request.postDataJSON() as { force: boolean }).force) return false;
      await route.fulfill({
        status: 422,
        json: {
          error: "TOOL_FAILED",
          message: "fix-login has changes that were not committed.",
          unforced: true,
        },
      });
      return true;
    },
  });
  await openWorkspace(page, detail);

  await page.getByRole("button", { name: "Actions for fix/login" }).click();
  await page.getByRole("menuitem", { name: "Remove workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove workspace fix/login?" });
  await expect(dialog.getByText("The working copy of fix/login on Laptop")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove anyway" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Remove workspace" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "fix-login has changes that were not committed.",
  );
  await dialog.getByRole("button", { name: "Remove anyway" }).click();

  await expect(page.getByRole("status")).toContainText("fix/login was removed from Laptop.");
  const path = `/api/projects/${widgets.id}/workspaces/wsp_login/remove`;
  expect(sent).toEqual([
    { method: "POST", path, body: { force: false } },
    { method: "POST", path, body: { force: true } },
  ]);
});

test("makes a location the default", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, detail);

  // The default has nothing to be made, and says so by not offering it.
  await page.getByRole("button", { name: "Actions for Laptop" }).click();
  await expect(page.getByRole("menuitem", { name: "Make default" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Actions for Exeora Cloud" }).click();
  await expect(page.getByRole("menuitem", { name: "Replace token" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Make default" }).click();

  await expect(page.getByRole("status")).toContainText("Exeora Cloud is the default location now.");
  expect(sent).toEqual([
    {
      method: "PUT",
      path: `/api/projects/${widgets.id}/default-location`,
      body: { locationId: "loc_widgets_cloud" },
    },
  ]);
});

test("removes a location after listing what goes with it", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, detail);

  // The gateway would refuse the default. It is said before it is asked.
  await page.getByRole("button", { name: "Actions for Laptop" }).click();
  await page.getByRole("menuitem", { name: "Remove location" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Choose another default location before removing this one.",
  );

  await page.getByRole("button", { name: "Actions for Exeora Cloud" }).click();
  await page.getByRole("menuitem", { name: "Remove location" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove Exeora Cloud from Widgets?" });
  await expect(dialog).toContainText(
    "The 3 instances for master · default, feature/billing, feature/search.",
  );
  await expect(dialog).toContainText("Anything on them that was not pushed.");
  await dialog.getByRole("button", { name: "Remove location" }).click();

  await expect(page.getByRole("status")).toContainText("Taking Widgets off Exeora Cloud.");
  expect(sent).toEqual([
    {
      method: "DELETE",
      path: `/api/projects/${widgets.id}/locations/loc_widgets_cloud`,
      body: null,
    },
  ]);
});

test("adds a machine as a location and refuses one whose CLI is too old", async ({ page }) => {
  const machine = (patch: Record<string, unknown>) => ({
    deviceId: "dev_server",
    kind: "local",
    name: "Server",
    platform: "linux",
    cliVersion: "0.18.2",
    online: true,
    state: "online",
    lastSeenAt: Date.now(),
    createdAt: Date.now(),
    revokedAt: null,
    projects: [],
    ...patch,
  });
  await signedIn(page);
  const sent = await mockPlaces(page, {
    machines: [
      machine({}),
      machine({ deviceId: "dev_old", name: "Old box", cliVersion: "0.17.4" }),
      machine({ deviceId: "dev_gone", name: "Gone", state: "removed", revokedAt: Date.now() }),
    ],
  });
  await openWorkspace(page, detail);

  await page.getByRole("button", { name: "Add location" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a location" });
  // Already on Exeora Cloud, and a revoked machine is no place to live.
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  await expect(dialog.getByRole("radio", { name: /Old box/ })).toBeDisabled();
  await expect(dialog.getByText("Update the CLI on this machine.")).toBeVisible();

  await dialog.getByRole("radio", { name: /Server/ }).check();
  await expect(dialog.getByText("Nothing is cloned now.")).toBeVisible();
  await dialog.getByRole("button", { name: "Add location" }).click();

  await expect(page.getByRole("status")).toContainText("Server is a location now.");
  expect(sent).toEqual([
    {
      method: "POST",
      path: `/api/projects/${widgets.id}/locations`,
      body: { deviceId: "dev_server" },
    },
  ]);
});

test("removes a project from its own page, naming what is destroyed", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, detail);

  await page.getByRole("button", { name: "Actions for Widgets" }).click();
  await page.getByRole("menuitem", { name: "Remove project" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove Widgets?" });
  await expect(dialog).toContainText("The 3 instances on Exeora Cloud");
  await expect(dialog).toContainText("Nothing on Laptop");
  await dialog.getByRole("button", { name: "Remove project" }).click();

  await expect(page).toHaveURL("/dashboard/projects");
  expect(sent).toEqual([{ method: "DELETE", path: `/api/projects/${widgets.id}`, body: null }]);
});

test("offers both ways to add a first project from the empty list", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { projects: [], machines: [], accountClients: [], github: githubOff });
  await openWorkspace(page, "/dashboard/projects");

  await expect(page.getByText("No projects yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(2);
  await page.getByRole("button", { name: "See how to use my machine" }).click();
  await expect(page.getByText("exeora project add .", { exact: true })).toBeVisible();
  // With no client on the account URL yet, the card that offers it is open.
  await expect(page.getByText(cloudUser.accountMcpUrl, { exact: true })).toBeVisible();
});

test("names a client that lost every project, and the page that fixes it", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { accountClients: [accountClient({ projects: [] })] });
  await page.goto("/dashboard/");

  const card = page.locator("section").filter({ hasText: "Needs your attention" });
  await expect(card.getByText("ChatGPT cannot reach any project.")).toBeVisible();
  await expect(card.getByText("The instance for feature/billing of Widgets failed.")).toBeVisible();
  await expect(page.getByText("1 running · 1 asleep", { exact: true })).toBeVisible();
  await expect(page.getByText("3 of 10 · 1 failed", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();

  await card.getByRole("link", { name: "Open Machines" }).click();
  await expect(page).toHaveURL("/dashboard/machines?view=cloud&state=failed");
});
