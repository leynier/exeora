import { expect, type Page, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { cloudUser, folder, project, resting, stray, user, widgets } from "./fixtures.js";
import { mockPlaces } from "./places-mock.js";

/**
 * A project outlives the places it lives. These are about what is left once
 * the last of them is gone: a repository with nowhere to live, and one on
 * Exeora Cloud with no instance for its root.
 */

const all = [widgets, project, stray, resting];

/** The block of one location on the project's page. */
const block = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("names a project that lives nowhere on the overview, and not one at rest", async ({
  page,
}) => {
  await signedIn(page);
  await mockPlaces(page, { projects: all });
  await page.goto("/dashboard/");

  const card = page.locator("section").filter({ hasText: "Needs your attention" });
  await expect(card.getByText("Stray lives nowhere.")).toBeVisible();
  await expect(card.getByText("Add a location.")).toBeVisible();
  // No instance is where Exeora Cloud rests between calls, not a problem.
  await expect(card.getByText(/Resting/)).toHaveCount(0);

  await card.getByRole("link", { name: "Open project" }).click();
  await expect(page).toHaveURL(`/dashboard/projects/${stray.id}`);
});

test("lists a project that lives nowhere, and gives it a location from its card", async ({
  page,
}) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { projects: all });
  await openWorkspace(page, "/dashboard/projects");

  const at = page.getByRole("article").filter({ hasText: "Resting" });
  const chips = at.getByRole("list", { name: "Locations of Resting" }).getByRole("listitem");
  await expect(chips).toHaveText(["no instanceExeora Clouddefault location"]);
  await expect(at.getByRole("button", { name: "Add location" })).toHaveCount(0);

  const card = page.getByRole("article").filter({ hasText: "Stray" });
  await expect(card.getByText("Lives nowhere.")).toBeVisible();
  await expect(card.getByRole("list")).toHaveCount(0);
  // It is still a project, with the address its clients were given.
  await card.getByText("Connect a client").click();
  await expect(card.getByText(stray.mcpUrl, { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Add location" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a location" });
  await expect(dialog).toContainText("A place for this project to live again");
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await dialog.getByRole("radio", { name: /Desktop/ }).check();
  await dialog.getByRole("button", { name: "Add location" }).click();

  await expect(page.getByRole("status")).toContainText("Desktop is a location now.");
  expect(sent).toEqual([
    {
      method: "POST",
      path: `/api/projects/${stray.id}/locations`,
      body: { deviceId: "dev_desktop" },
    },
  ]);
});

test("says a project lives nowhere on its page, and offers a location and no root", async ({
  page,
}) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { projects: all });
  await openWorkspace(page, `/dashboard/projects/${stray.id}`);

  await expect(page.getByRole("heading", { name: "Stray", level: 1 })).toBeVisible();
  const empty = block(page, "No location");
  await expect(empty.getByText("This project lives nowhere")).toBeVisible();
  await expect(empty).toContainText("It keeps its address, policy and clients");
  await expect(page.getByRole("link", { name: "Open workspace" })).toHaveCount(0);
  await expect(page.getByText(stray.mcpUrl, { exact: true })).toBeVisible();

  await empty.getByRole("button", { name: "Add location" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a location" });
  await dialog.getByRole("radio", { name: /Exeora Cloud/ }).check();
  await expect(dialog).toContainText("The next call to the project root starts one");
  await dialog.getByRole("button", { name: "Add location" }).click();

  await expect(page.getByRole("status")).toContainText(
    "The project is on Exeora Cloud, its default location.",
  );
  expect(sent).toEqual([
    { method: "POST", path: `/api/projects/${stray.id}/locations`, body: { kind: "cloud" } },
  ]);
});

test("adds a workspace to a project that lives nowhere by way of a location", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { projects: all });
  await openWorkspace(page, `/dashboard/projects/${stray.id}`);

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a workspace" });
  // With no location to choose, Exeora Cloud is what is left to offer.
  await expect(dialog.getByRole("button", { name: "Where" })).toContainText("Exeora Cloud");
  await expect(dialog).toContainText("The project is put on Exeora Cloud first.");
  await expect(dialog).toContainText("To use one of your machines instead, add it as a location.");

  await dialog.getByRole("button", { name: "Add location" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Add a location" })).toBeVisible();
});

test("sends an account without Cloud to add a location before a workspace", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { projects: all, me: user });
  await openWorkspace(page, `/dashboard/projects/${stray.id}`);

  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a workspace" });
  await dialog.getByLabel("Branch", { exact: true }).fill("feature/export");
  await expect(dialog).toContainText(
    "This project lives nowhere, so there is no place to make a workspace. Add a location first.",
  );
  await expect(dialog.getByRole("button", { name: "Add workspace" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Add location" })).toBeVisible();
  expect(sent).toEqual([]);
});

test("starts the instance for the root of a project on Cloud that holds none", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { projects: all });
  await openWorkspace(page, `/dashboard/projects/${resting.id}`);

  const cloud = block(page, "Exeora Cloud");
  await expect(cloud.getByText("no instance", { exact: true })).toBeVisible();
  await expect(cloud.getByText("default location", { exact: true })).toBeVisible();
  await expect(
    cloud.getByText("Exeora Cloud holds no instance for the project root."),
  ).toBeVisible();
  // There is no root to open until the instance is there.
  await expect(page.getByRole("link", { name: "Open workspace" })).toHaveCount(0);
  await expect(block(page, "No location")).toHaveCount(0);

  await cloud.getByRole("button", { name: "Start instance" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Setting up an instance for the root of Resting.",
  );
  expect(sent).toEqual([
    {
      method: "PUT",
      path: `/api/projects/${resting.id}/default-location`,
      body: { locationId: "loc_resting_cloud" },
    },
  ]);
});

test("says there is no room when the plan refuses to start an instance", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, {
    projects: all,
    handle: async (route, request, path) => {
      if (request.method() !== "PUT" || !path.endsWith("/default-location")) return false;
      await route.fulfill({ status: 403, json: { error: "plan_limit", max: 10 } });
      return true;
    },
  });
  await openWorkspace(page, `/dashboard/projects/${resting.id}`);

  const start = block(page, "Exeora Cloud").getByRole("button", { name: "Start instance" });
  await start.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Exeora Cloud has no room for another instance: all 10 of the plan are in use. Destroy one under Machines to make room.",
  );
  // Nothing was started, so it can be asked for again once there is room.
  await expect(start).toBeEnabled();
});

test("does not offer to start an instance to an account with Cloud switched off", async ({
  page,
}) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    projects: all,
    me: { ...cloudUser, cloudEnabled: false },
  });
  await openWorkspace(page, `/dashboard/projects/${resting.id}`);

  const cloud = block(page, "Exeora Cloud");
  await expect(
    cloud.getByText("Exeora Cloud is not enabled for this account. An administrator enables it."),
  ).toBeVisible();
  await expect(cloud.getByRole("button", { name: "Start instance" })).toBeDisabled();
  expect(sent).toEqual([]);
});

test("removes the last location of a repository, and says the project stays", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, `/dashboard/projects/${project.id}`);

  await page.getByRole("button", { name: "Actions for Laptop" }).click();
  await page
    .getByRole("menu", { name: "Actions for Laptop" })
    .getByRole("menuitem", { name: "Remove location" })
    .click();
  // The default and the only one, and still offered: the project is kept.
  const dialog = page.getByRole("dialog", { name: "Remove Laptop from E2E project?" });
  await expect(dialog).toContainText(
    "Exeora forgets that the project lives on this machine, the only place it lives.",
  );
  await expect(dialog).toContainText(
    "The project stays, with its address, policy and clients, and lives nowhere until it is given a location.",
  );
  await expect(dialog).toContainText("Nothing on Laptop itself.");
  await dialog.getByRole("button", { name: "Remove location" }).click();

  await expect(page.getByRole("status")).toContainText(
    "The project stays, and lives nowhere until it is given a location.",
  );
  expect(sent).toEqual([
    { method: "DELETE", path: `/api/projects/${project.id}/locations/loc_laptop`, body: null },
  ]);
});

test("refuses to remove the last location of a directory with no remote", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { projects: [folder] });
  await openWorkspace(page, `/dashboard/projects/${folder.id}`);

  await page.getByRole("button", { name: "Actions for Laptop" }).click();
  await page
    .getByRole("menu", { name: "Actions for Laptop" })
    .getByRole("menuitem", { name: "Remove location" })
    .click();

  await expect(page.getByRole("alert")).toHaveText(
    "This project is a directory on this machine and lives nowhere else. Remove the project instead.",
  );
  await expect(page.getByRole("dialog", { name: /^Remove Laptop/ })).toBeHidden();
  expect(sent).toEqual([]);
});

test("asks nothing of a root that cannot be opened, and says what is missing", async ({ page }) => {
  const asked: string[] = [];
  await signedIn(page);
  await mockPlaces(page, {
    projects: all,
    handle: (_route, _request, path) => {
      if (path.includes("/workspace/") || path.endsWith("/terminal-ticket")) asked.push(path);
      return false;
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${stray.id}`);

  await expect(page.getByText("Stray lives nowhere", { exact: true })).toBeVisible();
  await expect(page.getByText("Its root cannot be opened until it has a location")).toBeVisible();
  await expect(page.getByRole("link", { name: "the project's page" })).toHaveAttribute(
    "href",
    `/dashboard/projects/${stray.id}`,
  );
  // The same under the other tab: there is no machine to open a shell on.
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.getByText("Stray lives nowhere", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open terminal" })).toHaveCount(0);

  await openWorkspace(page, `/dashboard/workspace?project=${resting.id}`);
  await expect(page.getByText("Exeora Cloud holds no instance for this root")).toBeVisible();
  await expect(page.getByText("use Start instance on")).toBeVisible();
  expect(asked).toEqual([]);
});
