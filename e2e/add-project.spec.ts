import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { accountClient, cloudUser, github, user } from "./fixtures.js";
import { mockPlaces } from "./places-mock.js";

const created = { method: "POST", path: "/api/cloud/projects" };

test("adds a project picked from GitHub, with no branch and no token", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { accountClients: [] });
  await openWorkspace(page, "/dashboard/projects");

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await expect(dialog.getByText("Step 1 of 2")).toBeVisible();
  // The branch is the gateway's to read, so it is not a field anybody sees.
  await expect(dialog.getByLabel("Default branch")).toBeHidden();

  // A repository that is already a project is a way to that project.
  await expect(dialog.getByRole("link", { name: /example\/widgets/ })).toContainText(
    "already a project",
  );
  await expect(dialog.getByRole("option")).toHaveCount(1);

  const search = dialog.getByRole("combobox", { name: "Repository on GitHub" });
  await search.fill("gad");
  await expect(dialog.getByRole("link", { name: /example\/widgets/ })).toHaveCount(0);
  await search.press("Enter");
  await expect(dialog.getByRole("option", { name: /example\/gadgets/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByText("slug: gadgets")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();

  await expect(dialog.getByRole("radio", { name: /Exeora Cloud/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Add project" }).click();

  await expect(page).toHaveURL("/dashboard/projects/prj_new");
  expect(sent).toEqual([
    {
      ...created,
      body: {
        name: "gadgets",
        slug: "gadgets",
        repoUrl: "https://github.com/example/gadgets.git",
        github: { repositoryId: 9001, installationId: 101 },
      },
    },
  ]);
});

test("shows why the gateway could not read a repository, inside the dialog", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    accountClients: [],
    github: { ...github, connected: false, installations: [] },
    handle: async (route, request, path) => {
      if (request.method() !== "POST" || path !== "/api/cloud/projects") return false;
      await route.fulfill({
        status: 422,
        json: {
          error: "clone_auth_failed",
          message: "The repository refused access. Give a token that can read it.",
        },
      });
      return true;
    },
  });
  await openWorkspace(page, "/dashboard/projects");

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  // Not connected: connecting is offered, and the address still works.
  await expect(dialog.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);

  await dialog.getByLabel("Repository URL").fill("https://git.example.com/team/Gadgets.git");
  await expect(dialog.getByText("slug: gadgets")).toBeVisible();
  await dialog.getByLabel("Access token").fill("glpat_secret");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Add project" }).click();

  await expect(dialog.getByRole("alert")).toHaveText(
    "The repository refused access. Give a token that can read it.",
  );
  await expect(page).toHaveURL("/dashboard/projects");
  expect(sent).toEqual([
    {
      ...created,
      body: {
        name: "Gadgets",
        slug: "gadgets",
        repoUrl: "https://git.example.com/team/Gadgets.git",
        token: "glpat_secret",
      },
    },
  ]);
});

test("gives the command to run for a project on one of my machines", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { accountClients: [] });
  await openWorkspace(page, "/dashboard/projects");

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByRole("option", { name: /example\/gadgets/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("radio", { name: /One of my machines/ }).check();

  await expect(
    dialog.getByText("exeora project add example/gadgets", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("into that machine's projects folder")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy command" })).toBeVisible();
  // There is nothing for the dashboard to send: the machine does the adding.
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([]);
});

test("sends a new project to a machine when the account has no Cloud", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { me: user, accountClients: [] });
  await openWorkspace(page, "/dashboard/projects?add=1");

  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByRole("option", { name: /example\/gadgets/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();

  await expect(dialog.getByRole("radio", { name: /Exeora Cloud/ })).toBeDisabled();
  await expect(
    dialog.getByText("Exeora Cloud is not enabled for this account. An administrator enables it."),
  ).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /One of my machines/ })).toBeChecked();
  // The mark that opened the dialog is gone, so a reload does not reopen it.
  await expect(page).toHaveURL("/dashboard/projects");
});

test("refuses Exeora Cloud for a new project when every instance is in use", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, {
    me: { ...cloudUser, usage: { ...cloudUser.usage, cloudMachines: 10 } },
    accountClients: [],
  });
  await openWorkspace(page, "/dashboard/projects?add=1");

  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByRole("option", { name: /example\/gadgets/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("radio", { name: /Exeora Cloud/ })).toBeDisabled();
  await expect(dialog.getByText("Every instance of the plan is in use: 10 of 10.")).toBeVisible();
});

test("ticks the clients that arrive after the dialog opened, and keeps what was unticked", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const clients = [
    accountClient(),
    accountClient({ clientId: "client_cursor", clientName: "Cursor" }),
    accountClient({ clientId: "client_claude", clientName: "Claude", allProjects: true }),
  ];
  await signedIn(page);
  const sent = await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (request.method() !== "GET" || path !== "/api/account-clients") return false;
      await held;
      await route.fulfill({ status: 200, json: clients });
      return true;
    },
  });
  await openWorkspace(page, "/dashboard/projects");

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByRole("option", { name: /example\/gadgets/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();

  // Nobody can say yet which clients would be left without the project, so
  // the project cannot be added yet.
  const waiting = dialog.getByRole("button", { name: "Loading clients…" });
  await expect(waiting).toBeDisabled();

  release();
  await expect(dialog.getByText("Step 2 of 3")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();

  // Ticked although the dialog was open before they were known.
  await expect(dialog.getByLabel("ChatGPT")).toBeChecked();
  await expect(dialog.getByLabel("Cursor")).toBeChecked();
  // Given every project, so listed and not asked about.
  await expect(dialog.getByLabel("Claude")).toBeDisabled();

  await dialog.getByLabel("Cursor").uncheck();
  // The list is fetched again while the dialog is open, as it is every few
  // seconds. What was unticked by hand stays unticked.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await dialog.getByRole("button", { name: "Back" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByLabel("Cursor")).not.toBeChecked();
  await expect(dialog.getByLabel("ChatGPT")).toBeChecked();

  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(page).toHaveURL("/dashboard/projects/prj_new");
  expect(sent.at(-1)?.body).toMatchObject({ clientIds: ["client_chatgpt"] });
});

test("does not take a failed list of clients for an account with nobody to ask", async ({
  page,
}) => {
  let failing = true;
  await signedIn(page);
  const sent = await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (request.method() !== "GET" || path !== "/api/account-clients" || !failing) return false;
      await route.fulfill({ status: 500, json: { error: "internal_error" } });
      return true;
    },
  });
  await openWorkspace(page, "/dashboard/projects");

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByRole("option", { name: /example\/gadgets/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  // The step that asks about clients is there although none could be read.
  await expect(dialog.getByText("Step 2 of 3")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "The clients connected through the account URL could not be loaded.",
  );
  const add = dialog.getByRole("button", { name: "Add project" });
  await expect(add).toBeDisabled();

  // Going ahead without them is a choice somebody makes, and can take back.
  const without = dialog.getByLabel("Add the project without giving it to any client");
  await without.check();
  await expect(add).toBeEnabled();
  await without.uncheck();
  await expect(add).toBeDisabled();

  failing = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByLabel("ChatGPT")).toBeChecked();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await add.click();

  await expect(page).toHaveURL("/dashboard/projects/prj_new");
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toMatchObject({ clientIds: ["client_chatgpt"] });
});

test("adds a project to no client only when that was asked for in so many words", async ({
  page,
}) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (request.method() !== "GET" || path !== "/api/account-clients") return false;
      await route.fulfill({ status: 500, json: { error: "internal_error" } });
      return true;
    },
  });
  await openWorkspace(page, "/dashboard/projects");

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a project" });
  await dialog.getByRole("option", { name: /example\/gadgets/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();

  // Trying again against a gateway that still fails leaves the step as it was.
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("alert")).toContainText("could not be loaded");
  await expect(dialog.getByRole("button", { name: "Add project" })).toBeDisabled();

  await dialog.getByLabel("Add the project without giving it to any client").check();
  await dialog.getByRole("button", { name: "Add project" }).click();

  await expect(page).toHaveURL("/dashboard/projects/prj_new");
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).not.toHaveProperty("clientIds");
});
