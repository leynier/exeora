import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { accountClient, widgets } from "./fixtures.js";
import { mockPlaces } from "./places-mock.js";

const put = { method: "PUT", path: "/api/account-clients/projects" };
const standing = "All projects, including the ones you add later";

test("asks before taking every project from a client that reaches none yet", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    projects: [widgets],
    accountClients: [accountClient({ allProjects: true, projects: [] })],
  });
  await openWorkspace(page, "/dashboard/clients");

  await page.getByRole("button", { name: "Edit access" }).click();
  // A click and not `uncheck`: the box follows the server, which has not
  // been told anything yet.
  await page.getByLabel(standing).click();

  // An empty list is what revokes the token, so nothing is sent on the tick.
  const dialog = page.getByRole("dialog", { name: "Cut ChatGPT off?" });
  await expect(dialog).toContainText("It reaches no project yet");
  await expect(dialog).toContainText("it has to be authorized again from the client");
  expect(sent).toEqual([]);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel(standing)).toBeChecked();
  expect(sent).toEqual([]);

  await page.getByLabel(standing).click();
  await dialog.getByRole("button", { name: "Cut it off" }).click();
  await expect(page.getByRole("status")).toContainText("Access updated.");
  expect(sent).toEqual([
    { ...put, body: { clientId: "client_chatgpt", projectIds: [], allProjects: false } },
  ]);
});

test("clears the standing answer without asking when projects are left", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    projects: [widgets],
    accountClients: [accountClient({ allProjects: true })],
  });
  await openWorkspace(page, "/dashboard/clients");

  await page.getByRole("button", { name: "Edit access" }).click();
  await page.getByLabel(standing).click();

  await expect(page.getByRole("status")).toContainText("Access updated.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent).toEqual([
    {
      ...put,
      body: { clientId: "client_chatgpt", projectIds: [widgets.id], allProjects: false },
    },
  ]);
});
