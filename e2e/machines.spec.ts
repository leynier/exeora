import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { cloudUser, instance, laptop, machines, project, user, widgets } from "./fixtures.js";
import { mockPlaces } from "./places-mock.js";

const cloud = "/dashboard/machines?view=cloud";

test("sends the old Cloud address to the Exeora Cloud tab of Machines", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, "/dashboard/cloud");

  await expect(page).toHaveURL(cloud);
  await expect(page.getByRole("tab", { name: /Exeora Cloud/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("asks the provider for the state of the instances on this page only", async ({ page }) => {
  const asked: string[] = [];
  await signedIn(page);
  await mockPlaces(page, {
    handle: (_route, request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/machines") asked.push(url.search);
      return false;
    },
  });
  await page.goto("/dashboard/");
  await expect(page.getByText("Needs your attention")).toBeVisible();
  expect(asked).not.toContain("?live=1");

  await page.getByRole("link", { name: "Machines", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Your machines/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect.poll(() => asked).toContain("?live=1");
});

test("shows every instance with its state, and how much room is left", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, cloud);

  await expect(page.getByText("3 of 10 instances")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Instances in use" })).toHaveAttribute(
    "aria-valuenow",
    "3",
  );

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("link", { name: "Widgets" })).toHaveCount(3);
  // The root by its branch and the mark, a workspace by its branch.
  await expect(panel.getByText("master", { exact: true })).toBeVisible();
  await expect(panel.getByText("default", { exact: true })).toHaveCount(1);
  await expect(panel.getByText("feature/search", { exact: true })).toBeVisible();
  // The state is Exeora's word, and what the provider says is a hint beside it.
  await expect(panel.getByText(/^asleep· cold, resumes in a moment$/)).toBeVisible();
  await expect(panel.getByText(/^online· running$/)).toBeVisible();
  await expect(panel.getByText(/^failed$/)).toHaveCount(2);

  await expect(panel.getByText("The instance could not be set up.")).toBeVisible();
  // What the instance said is there for whoever asks, folded away.
  await expect(panel.getByText("The service wrote no log.")).toBeHidden();
  await panel.getByText("Details", { exact: true }).click();
  await expect(panel.getByText("The service wrote no log.")).toBeVisible();

  // Running or a call away from it opens. What failed is retried instead.
  await expect(panel.getByRole("link", { name: "Open workspace" })).toHaveCount(1);
  await expect(panel.getByRole("link", { name: "Open workspace" })).toHaveAttribute(
    "href",
    `/dashboard/workspace?project=${widgets.id}&workspace=feature-search`,
  );
});

test("narrows the instances by state and keeps the filter in the address", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, `${cloud}&state=failed`);

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "1 instance" })).toBeVisible();
  await expect(panel.getByText("feature/billing")).toBeVisible();
  await expect(panel.getByText("feature/search")).toHaveCount(0);

  await panel.getByRole("button", { name: "Filter by state" }).click();
  await page.getByRole("option", { name: "Any state" }).click();
  await expect(page).toHaveURL(cloud);
  await expect(panel.getByRole("heading", { name: "3 instances" })).toBeVisible();
});

test("retries an instance that failed", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, cloud);

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toContainText("Setting up feature/billing again.");
  expect(sent).toEqual([
    { method: "POST", path: "/api/cloud/machines/dev_cloud_billing/retry", body: null },
  ]);
});

test("destroys the instance of a workspace, saying what is lost", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    handle: async (route, _request, path) => {
      if (!path.endsWith("/remove")) return false;
      await route.fulfill({ status: 202, json: { ok: true, status: "removing" } });
      return true;
    },
  });
  await openWorkspace(page, cloud);

  await page.getByRole("button", { name: "Actions for feature/search" }).click();
  await page.getByRole("menuitem", { name: "Destroy" }).click();
  // The same confirmation the project's page opens for this workspace.
  const dialog = page.getByRole("dialog", { name: "Remove workspace feature/search?" });
  await expect(dialog).toContainText("The instance on Exeora Cloud that runs feature/search.");
  await expect(dialog).toContainText("Anything on it that was not pushed.");
  await dialog.getByRole("button", { name: "Remove workspace" }).click();

  await expect(page.getByRole("status")).toContainText("Removing feature/search.");
  expect(sent).toEqual([
    {
      method: "POST",
      path: `/api/projects/${widgets.id}/workspaces/wsp_search/remove`,
      body: { force: false },
    },
  ]);
});

test("destroys the root instance and leaves the project where else it lives", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, cloud);

  await page.getByRole("button", { name: "Actions for master · default" }).click();
  await page.getByRole("menuitem", { name: "Destroy" }).click();
  const dialog = page.getByRole("dialog", { name: "Destroy the instance for master · default?" });
  await expect(dialog).toContainText("Anything on it that was not pushed is lost");
  await expect(dialog).toContainText("The project keeps its other locations");
  await dialog.getByRole("button", { name: "Destroy instance" }).click();

  await expect(page.getByRole("status")).toContainText("Destroying the instance");
  expect(sent).toEqual([{ method: "DELETE", path: "/api/devices/dev_cloud_root", body: null }]);
});

test("says the whole project goes with the root of one that lives only on Cloud", async ({
  page,
}) => {
  const onlyCloud = {
    ...widgets,
    deviceId: "dev_cloud_root",
    locations: widgets.locations
      .filter((entry) => entry.kind === "cloud")
      .map((entry) => ({ ...entry, default: true })),
  };
  await signedIn(page);
  const sent = await mockPlaces(page, { projects: [onlyCloud], machines: [instance()] });
  await openWorkspace(page, cloud);

  await page.getByRole("button", { name: "Actions for master · default" }).click();
  await page.getByRole("menuitem", { name: "Destroy" }).click();
  // Asked for as what it is, behind the one confirmation a project has.
  const dialog = page.getByRole("dialog", { name: "Remove Widgets?" });
  await expect(dialog).toContainText("Its MCP URL.");
  await expect(dialog).toContainText("The instance on Exeora Cloud (master · default)");
  await dialog.getByRole("button", { name: "Remove project" }).click();

  await expect(page.getByRole("status")).toContainText("Removing Widgets.");
  expect(sent).toEqual([{ method: "DELETE", path: `/api/projects/${widgets.id}`, body: null }]);
});

test("lists what each of my machines holds, behind a disclosure", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, "/dashboard/machines");

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Laptop", { exact: true })).toBeVisible();
  await expect(panel.getByText("linux · CLI 0.18.0 · connected now")).toBeVisible();
  await expect(panel.getByText("online", { exact: true })).toHaveCount(2);
  // Instances are machines too, and they are under their own tab.
  await expect(panel.getByText("widgets-main")).toHaveCount(0);

  await expect(panel.getByRole("link", { name: "Widgets" })).toBeHidden();
  await panel.getByText(/^2 projects/).click();
  await expect(panel.getByRole("link", { name: "Widgets" })).toHaveAttribute(
    "href",
    `/dashboard/projects/${widgets.id}`,
  );
  await expect(panel.getByText("/work/widgets")).toBeVisible();
});

test("deleting a machine names the projects that go and the ones that survive", async ({
  page,
}) => {
  const revoked = machines.map((machine) =>
    machine.deviceId === laptop.deviceId
      ? { ...machine, online: false, state: "removed", revokedAt: Date.now() }
      : machine,
  );
  await signedIn(page);
  const sent = await mockPlaces(page, { machines: revoked });
  await openWorkspace(page, "/dashboard/machines");

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("removed", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete Laptop?" });
  // It lives only on the laptop. Widgets is on Exeora Cloud as well.
  await expect(dialog.getByText("Deleted with it")).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: project.name })).toBeVisible();
  await expect(dialog.getByText("These survive, in their other locations:")).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: "Widgets" })).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveText([project.name, "Widgets"]);

  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("status")).toContainText("Laptop was deleted.");
  expect(sent).toEqual([
    { method: "DELETE", path: "/api/devices/dev_e2e/permanently", body: null },
  ]);
});

test("tells an account without Cloud what it is and who enables it", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { me: user, machines: [laptop] });
  await openWorkspace(page, cloud);

  await expect(page.getByText("Exeora Cloud is not enabled for this account")).toBeVisible();
  await expect(page.getByText("An administrator enables it for an account.")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("keeps the instances of an account switched off in view, to be destroyed", async ({
  page,
}) => {
  await signedIn(page);
  await mockPlaces(page, { me: { ...cloudUser, cloudEnabled: false } });
  await openWorkspace(page, cloud);

  await expect(page.getByText("Exeora Cloud is switched off for this account.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeDisabled();
  await page.getByRole("button", { name: "Actions for feature/search" }).click();
  await expect(page.getByRole("menuitem", { name: "Destroy" })).toBeEnabled();
});
