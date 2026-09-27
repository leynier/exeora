import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { github, githubOff } from "./fixtures.js";
import { mockPlaces } from "./places-mock.js";

test("leaves for GitHub with a fresh address to connect an account", async ({ page }) => {
  let asked = 0;
  await signedIn(page);
  await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (request.method() !== "GET" || path !== "/api/github") return false;
      asked += 1;
      await route.fulfill({
        status: 200,
        json: {
          ...github,
          connected: false,
          installations: [],
          connectUrl: `https://github.com/apps/exeora/installations/new?state=signed-${asked}`,
        },
      });
      return true;
    },
  });
  await page.route("https://github.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>GitHub</title>" }),
  );
  await openWorkspace(page, "/dashboard/settings");

  await expect(page.getByText("Connecting GitHub lets you add a project by picking")).toBeVisible();
  await page.getByRole("button", { name: "Connect GitHub" }).click();

  // The state in the address is good for minutes, so the one that came with
  // the page is not the one that is used.
  await page.waitForURL("https://github.com/apps/exeora/installations/new?state=signed-2");
});

test("says how the trip to GitHub ended and takes the answer out of the address", async ({
  page,
}) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, "/dashboard/settings?github=connected");

  await expect(page.getByRole("status")).toContainText("GitHub is connected.");
  await expect(page).toHaveURL("/dashboard/settings");

  await openWorkspace(page, "/dashboard/settings?github=failed&reason=denied");
  await expect(page.getByRole("alert")).toContainText("the installation was cancelled");
  await expect(page).toHaveURL("/dashboard/settings");
});

test("lists the connected accounts and disconnects one after saying what stops", async ({
  page,
}) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, "/dashboard/settings");

  const card = page.locator("section").filter({ hasText: "GitHub" }).first();
  await expect(card.getByText("example", { exact: true })).toBeVisible();
  await expect(card.getByText("selected repositories")).toBeVisible();
  await expect(card.getByRole("link", { name: "Change repositories" })).toHaveAttribute(
    "href",
    github.installations[0]?.manageUrl ?? "",
  );
  // The plan counts what Exeora Cloud runs by the name the rest of the pages use.
  await expect(page.getByText("Cloud instances", { exact: true })).toBeVisible();
  await expect(page.getByText("Cloud workspaces")).toHaveCount(0);

  await card.getByRole("button", { name: "Disconnect" }).click();
  const dialog = page.getByRole("dialog", { name: "Disconnect example?" });
  await expect(dialog).toContainText(
    "Projects keep working with the credentials each machine already has.",
  );
  await expect(dialog).toContainText(
    "Cloud instances will no longer be able to fetch or push until GitHub is reconnected.",
  );
  await dialog.getByRole("button", { name: "Disconnect" }).click();

  await expect(page.getByRole("status")).toContainText("example is disconnected.");
  expect(sent).toEqual([
    { method: "DELETE", path: "/api/github/installations/ghi_101", body: null },
  ]);
});

test("has no GitHub card on a gateway that has no GitHub app", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { github: githubOff });
  await openWorkspace(page, "/dashboard/settings");

  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub" })).toHaveCount(0);
});
