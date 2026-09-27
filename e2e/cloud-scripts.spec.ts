import { expect, type Page, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { folder, held, laptop, project, resting, user, widgets } from "./fixtures.js";
import { savedScripts } from "./hooks-fixtures.js";
import { mockPlaces } from "./places-mock.js";

const detail = `/dashboard/projects/${widgets.id}`;
const scriptsPath = `/api/projects/${widgets.id}/cloud-scripts`;

const INSTALL_FILE = ".exeora/cloud_install.sh";
const RESUME_FILE = ".exeora/cloud_resume.sh";

/** The card of the scripts on the project's page. */
const card = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Cloud scripts" }) });

test("shows what the project saved, and what each field runs as it stands", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { scripts: savedScripts });
  await openWorkspace(page, detail);

  const scripts = card(page);
  const install = scripts.getByLabel("Cloud Install script", { exact: true });
  const resume = scripts.getByLabel("Cloud Resume script", { exact: true });
  await expect(install).toHaveValue("pnpm install --frozen-lockfile\n");
  await expect(resume).toHaveValue("");
  await expect(
    scripts.getByText("Runs once when an instance is set up, and again when the script changes."),
  ).toBeVisible();
  await expect(
    scripts.getByText("Runs every time an instance resumes. Keep it short and safe to run twice."),
  ).toBeVisible();

  // The page replaces the repository, and an empty field leaves it to the file.
  await expect(scripts.getByText(`Replaces ${INSTALL_FILE} from the repository.`)).toBeVisible();
  await expect(
    scripts.getByText(`Empty: ${RESUME_FILE} from the repository runs when it exists.`),
  ).toBeVisible();

  const repository = scripts.getByRole("checkbox", {
    name: "Run the scripts found in the repository",
    exact: true,
  });
  await expect(repository).toBeChecked();
  await expect(
    scripts.getByText(
      "They run outside the project's policy and approvals: whoever can push to the branch runs code in the instance.",
    ),
  ).toBeVisible();
  // Nothing moved, so there is nothing to save, and no counter far from the limit.
  await expect(scripts.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(scripts.getByText(/of 16 384 bytes/)).toHaveCount(0);
});

test("says what runs as the fields and the switch change, before anything is saved", async ({
  page,
}) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, detail);

  const scripts = card(page);
  const install = scripts.getByLabel("Cloud Install script", { exact: true });
  const repository = scripts.getByRole("checkbox", {
    name: "Run the scripts found in the repository",
    exact: true,
  });
  await expect(
    scripts.getByText(`Empty: ${INSTALL_FILE} from the repository runs when it exists.`),
  ).toBeVisible();
  await expect(
    scripts.getByText(`Empty: ${RESUME_FILE} from the repository runs when it exists.`),
  ).toBeVisible();

  await install.fill("npm ci");
  await expect(scripts.getByText(`Replaces ${INSTALL_FILE} from the repository.`)).toBeVisible();

  // With the files switched off, the script on the page still runs, and an
  // empty field runs nothing at all.
  await repository.uncheck();
  await expect(scripts.getByText(`Replaces ${INSTALL_FILE} from the repository.`)).toBeVisible();
  await expect(scripts.getByText("Empty: nothing runs.")).toHaveCount(1);

  // Spaces are not a script, and must not look like one.
  await install.fill("   \n  ");
  await expect(scripts.getByText("Empty: nothing runs.")).toHaveCount(2);

  await repository.check();
  await expect(
    scripts.getByText(`Empty: ${INSTALL_FILE} from the repository runs when it exists.`),
  ).toBeVisible();
  // Back where it began: nothing to save, and nothing was.
  await expect(scripts.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(sent).toEqual([]);
});

test("saves the scripts and the switch, and says when instances pick them up", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, { scripts: savedScripts });
  await openWorkspace(page, detail);

  const scripts = card(page);
  const save = scripts.getByRole("button", { name: "Save" });
  await scripts.getByLabel("Cloud Install script", { exact: true }).fill("");
  await scripts.getByLabel("Cloud Resume script", { exact: true }).fill("docker compose up -d");
  await scripts
    .getByRole("checkbox", { name: "Run the scripts found in the repository", exact: true })
    .uncheck();
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByRole("status")).toContainText(
    "Scripts saved. Instances pick them up the next time they resume.",
  );
  expect(sent).toEqual([
    {
      method: "PUT",
      path: scriptsPath,
      body: { install: null, resume: "docker compose up -d", runRepositoryScripts: false },
    },
  ]);
  // The field holds what the gateway kept, and there is nothing left to save.
  await expect(scripts.getByLabel("Cloud Resume script", { exact: true })).toHaveValue(
    "docker compose up -d\n",
  );
  await expect(save).toBeDisabled();
  await expect(scripts.getByText("Empty: nothing runs.")).toHaveCount(1);
  await expect(scripts.getByText(`Replaces ${RESUME_FILE} from the repository.`)).toBeVisible();
});

test("refuses a script over the limit, counted in bytes, and says why", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page);
  await openWorkspace(page, detail);

  const scripts = card(page);
  const install = scripts.getByLabel("Cloud Install script", { exact: true });
  const save = scripts.getByRole("button", { name: "Save" });

  // Near the limit the counter shows, and the script can still be saved.
  await install.fill("a".repeat(16_384));
  await expect(scripts.getByText("16 384 of 16 384 bytes")).toBeVisible();
  await expect(scripts.getByRole("alert")).toHaveCount(0);
  await expect(save).toBeEnabled();

  // 8 193 characters, each of them two bytes: under the limit by one count
  // and over it by the one the gateway uses.
  await install.fill("é".repeat(8_193));
  await expect(scripts.getByText("16 386 of 16 384 bytes")).toBeVisible();
  await expect(scripts.getByRole("alert")).toHaveText(
    "The install script is 16 386 bytes, and the limit is 16 384. Shorten it to save.",
  );
  await expect(install).toHaveAttribute("aria-invalid", "true");
  await expect(save).toBeDisabled();

  await install.fill("npm ci");
  await expect(scripts.getByRole("alert")).toHaveCount(0);
  await expect(scripts.getByText(/of 16 384 bytes/)).toHaveCount(0);
  await expect(save).toBeEnabled();
  expect(sent).toEqual([]);
});

test("says what the gateway refused under the script it refused", async ({ page }) => {
  let refusal: Record<string, unknown> = {
    error: "script_too_large",
    hook: "resume",
    max: 16_384,
  };
  await signedIn(page);
  await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (request.method() !== "PUT" || path !== scriptsPath) return false;
      await route.fulfill({ status: 422, json: refusal });
      return true;
    },
  });
  await openWorkspace(page, detail);

  const scripts = card(page);
  const resume = scripts.getByLabel("Cloud Resume script", { exact: true });
  const save = scripts.getByRole("button", { name: "Save" });
  await resume.fill("make up");
  await save.click();
  await expect(scripts.getByRole("alert")).toHaveText(
    "The resume script is larger than 16 384 bytes. Shorten it, then save again.",
  );
  // What was written is still there, and still to be saved.
  await expect(resume).toHaveValue("make up");
  await expect(save).toBeEnabled();

  // The refusal is about what the field held: it goes when the field changes.
  await resume.fill("make up-fast");
  await expect(scripts.getByRole("alert")).toHaveCount(0);

  refusal = {
    error: "invalid_script",
    hook: "resume",
    message: "The script holds a character no shell can read. Paste it again as plain text.",
  };
  await save.click();
  await expect(scripts.getByRole("alert")).toHaveText(
    "The resume script was not saved. The script holds a character no shell can read. Paste it again as plain text.",
  );
});

test("says a project that is gone is gone, and a gateway that failed did", async ({ page }) => {
  let answer: { status: number; json: Record<string, unknown> } = {
    status: 404,
    json: { error: "not_found" },
  };
  await signedIn(page);
  await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (request.method() !== "PUT" || path !== scriptsPath) return false;
      await route.fulfill(answer);
      return true;
    },
  });
  await openWorkspace(page, detail);

  const scripts = card(page);
  await scripts.getByLabel("Cloud Install script", { exact: true }).fill("npm ci");
  await scripts.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This project no longer exists, so the scripts were not saved. Reload the page.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 10_000 });

  answer = { status: 500, json: { error: "internal" } };
  await scripts.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The scripts were not saved. The gateway could not complete the request.",
  );
  await expect(scripts.getByLabel("Cloud Install script", { exact: true })).toHaveValue("npm ci");
});

test("says the scripts could not be loaded, and loads them when asked again", async ({ page }) => {
  let down = true;
  await signedIn(page);
  await mockPlaces(page, {
    scripts: savedScripts,
    handle: async (route, request, path) => {
      if (request.method() !== "GET" || path !== scriptsPath || !down) return false;
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
      return true;
    },
  });
  await openWorkspace(page, detail);

  const scripts = card(page);
  await expect(scripts.getByText("The scripts could not be loaded.")).toBeVisible();
  // No field to write in: a draft over scripts nobody has read would replace them.
  await expect(scripts.getByRole("textbox")).toHaveCount(0);
  await expect(scripts.getByRole("button", { name: "Save" })).toHaveCount(0);

  down = false;
  await scripts.getByRole("button", { name: "Try again" }).click();
  await expect(scripts.getByLabel("Cloud Install script", { exact: true })).toHaveValue(
    "pnpm install --frozen-lockfile\n",
  );
});

test("has the card for a project on Exeora Cloud, and for an account that has Cloud", async ({
  page,
}) => {
  await signedIn(page);
  // Cloud switched off for the account, and the project still on it.
  await mockPlaces(page, { me: user, projects: [resting, project], machines: [laptop] });
  await openWorkspace(page, `/dashboard/projects/${resting.id}`);
  await expect(page.getByRole("heading", { name: "Resting", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cloud scripts" })).toBeVisible();

  // On a laptop only, in an account that has no Cloud to put it on.
  await openWorkspace(page, `/dashboard/projects/${project.id}`);
  await expect(page.getByRole("heading", { name: "E2E project", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What agents may do here" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cloud scripts" })).toHaveCount(0);
});

test("has no card for a directory with no repository, which can never be on Cloud", async ({
  page,
}) => {
  const asked: string[] = [];
  await signedIn(page);
  await mockPlaces(page, {
    projects: [folder, project],
    machines: [{ ...laptop, projects: [held(folder), held(project)] }],
    handle: (_route, _request, path) => {
      if (path.endsWith("/cloud-scripts")) asked.push(path);
      return false;
    },
  });
  await openWorkspace(page, `/dashboard/projects/${folder.id}`);
  await expect(page.getByRole("heading", { name: "Folder", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What agents may do here" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cloud scripts" })).toHaveCount(0);
  expect(asked).toEqual([]);

  // The same account has the card on a project that is a repository.
  await openWorkspace(page, `/dashboard/projects/${project.id}`);
  await expect(page.getByRole("heading", { name: "Cloud scripts" })).toBeVisible();
});
