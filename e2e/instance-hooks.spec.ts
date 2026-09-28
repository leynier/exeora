import { expect, type Page, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { widgets } from "./fixtures.js";
import {
  githubAccepted,
  githubWaiting,
  hookRun,
  hooks,
  machinesWith,
  SEARCH,
  timedOutResume,
  toolsReport,
} from "./hooks-fixtures.js";
import { mockPlaces } from "./places-mock.js";

const detail = `/dashboard/projects/${widgets.id}`;
const runPath = (hook: string) => `/api/cloud/machines/${SEARCH}/hooks/${hook}/run`;

/** The block of Exeora Cloud on the project's page. */
const cloud = (page: Page) => page.getByRole("region", { name: "Exeora Cloud", exact: true });

/** What the row of an instance says about one of its scripts. */
const notice = (page: Page, hook: "Install" | "Resume") =>
  page.getByRole("group", { name: `${hook} script` });

test("warns of an install script that failed, shows what it printed, and runs it again", async ({
  page,
}) => {
  // What the instance reports, which changes once it is asked to run again.
  let install = hookRun();
  await signedIn(page);
  const sent = await mockPlaces(page, {
    handle: async (route, request, path) => {
      if (path === "/api/machines" && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          json: { machines: machinesWith({ hooks: hooks({ install }) }) },
        });
        return true;
      }
      if (request.method() !== "POST" || path !== runPath("install")) return false;
      install = hookRun({
        runId: "run_install_2",
        status: "running",
        trigger: "manual",
        exitCode: null,
        startedAt: Date.now(),
        finishedAt: null,
        output: undefined,
        truncated: false,
      });
      await route.fulfill({ status: 202, json: { ok: true } });
      return true;
    },
  });
  await openWorkspace(page, detail);

  const warning = notice(page, "Install");
  await expect(warning).toContainText("The install script failed (exit 3).");
  await expect(warning).toContainText("It came from the project's page.");
  await expect(warning).toContainText("Fix the script, then run it again.");
  // The instance is ready: it is online and opens, and only what could not
  // be made is called failed, which is the instance for feature/billing.
  await expect(cloud(page).getByText(/^online· running$/)).toHaveCount(1);
  await expect(cloud(page).getByText(/^failed$/)).toHaveCount(1);
  await expect(cloud(page).getByRole("link", { name: "Open workspace" })).toHaveCount(2);

  // What the script printed is there for whoever asks, folded away.
  await expect(warning.getByText("ERR_PNPM_OUTDATED_LOCKFILE")).toBeHidden();
  await warning.getByText("Details", { exact: true }).click();
  await expect(warning.locator("pre")).toContainText("ERR_PNPM_OUTDATED_LOCKFILE  Cannot install");
  await expect(warning.getByText("Only the end is shown.")).toBeVisible();

  await warning.getByRole("button", { name: "Run again" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Running the install script again on feature/search.",
  );
  expect(sent).toEqual([{ method: "POST", path: runPath("install"), body: null }]);

  await expect(warning).toContainText("Running the install script…");
  await expect(warning.getByRole("button", { name: "Run again" })).toBeDisabled();
  await expect(warning).not.toContainText("failed");
  await expect(warning.getByText("Details", { exact: true })).toHaveCount(0);

  // It went well this time, and a script that went well is not spoken of.
  install = hookRun({
    runId: "run_install_2",
    status: "ok",
    trigger: "manual",
    exitCode: 0,
    output: undefined,
    truncated: false,
  });
  await expect(warning).toHaveCount(0, { timeout: 15_000 });
});

test("says a script is running, and does not offer to run it again meanwhile", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, {
    machines: machinesWith({
      hooks: hooks({
        resume: hookRun({
          runId: "run_resume_2",
          status: "running",
          trigger: "cold",
          exitCode: null,
          startedAt: Date.now() - 5_000,
          finishedAt: null,
          output: undefined,
          truncated: false,
        }),
      }),
    }),
  });
  await openWorkspace(page, "/dashboard/machines?view=cloud");

  const running = notice(page, "Resume");
  await expect(running).toContainText("Running the resume script…");
  await expect(running.getByRole("button", { name: "Run again" })).toBeDisabled();
  await expect(notice(page, "Install")).toHaveCount(0);
});

test("warns of a resume script that ran out of time, and where it came from", async ({ page }) => {
  await signedIn(page);
  const sent = await mockPlaces(page, {
    machines: machinesWith({
      online: false,
      state: "asleep",
      hooks: hooks({ install: hookRun({ status: "ok", exitCode: 0 }), resume: timedOutResume }),
    }),
  });
  await openWorkspace(page, "/dashboard/machines?view=cloud");

  const warning = notice(page, "Resume");
  await expect(warning).toContainText("The resume script ran out of time after 2 minutes.");
  await expect(warning).toContainText("It came from the repository.");
  // The whole of what it printed was kept, so nothing says it was cut.
  await warning.getByText("Details", { exact: true }).click();
  await expect(warning.locator("pre")).toHaveText("waiting for the database...");
  await expect(warning.getByText("Only the end is shown.")).toHaveCount(0);
  // The install script went well, and says so only to whoever asks.
  await expect(notice(page, "Install")).toHaveCount(0);

  await warning.getByRole("button", { name: "Run again" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Running the resume script again on feature/search.",
  );
  expect(sent).toEqual([{ method: "POST", path: runPath("resume"), body: null }]);
});

test("says why a script could not be run again, and what to do", async ({ page }) => {
  let answer = {
    status: 409,
    json: { error: "hooks_unsupported", message: "Too old to run scripts." },
  };
  await signedIn(page);
  await mockPlaces(page, {
    machines: machinesWith({ hooks: hooks({ install: hookRun() }) }),
    handle: async (route, request, path) => {
      if (request.method() !== "POST" || path !== runPath("install")) return false;
      await route.fulfill(answer);
      return true;
    },
  });
  await openWorkspace(page, detail);

  const again = notice(page, "Install").getByRole("button", { name: "Run again" });
  await again.click();
  await expect(page.getByRole("alert")).toHaveText(
    "This instance was made before scripts existed. Destroy it and start it again to run them.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 10_000 });

  answer = {
    status: 503,
    json: { error: "machine_waking", message: "Still waking." },
  };
  await again.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The instance is waking up. Try again in a moment.",
  );
  // The failure is still on the row, with the way to try once more.
  await expect(notice(page, "Install")).toContainText("The install script failed (exit 3).");
  await expect(again).toBeEnabled();
});

test("says scripts do not run on an instance made before they existed", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, {
    machines: machinesWith({
      cliVersion: "0.18.1",
      hooks: hooks({ supported: false }),
      tools: null,
    }),
  });
  await openWorkspace(page, "/dashboard/machines?view=cloud&state=online");

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("feature/search", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Run again" })).toHaveCount(0);
  await expect(notice(page, "Install")).toHaveCount(0);
  await expect(notice(page, "Resume")).toHaveCount(0);

  await panel.getByText("About this instance", { exact: true }).click();
  await expect(
    panel.getByText("Scripts do not run on this instance, which was made before they existed."),
  ).toBeVisible();
  await expect(panel.getByText("Install script", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Tools", { exact: true })).toHaveCount(0);
});

test("says what became of each script and each tool to whoever asks", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, {
    machines: machinesWith({
      hooks: hooks({
        install: hookRun({ status: "ok", exitCode: 0, source: "repository" }),
        resume: hookRun({ runId: "run_resume_3", status: "skipped", source: "none" }),
      }),
      tools: toolsReport,
    }),
  });
  await openWorkspace(page, "/dashboard/machines?view=cloud&state=online");

  const panel = page.getByRole("tabpanel");
  // A calm line on the row: the instance is ready, and two tools are missing.
  await expect(
    panel.getByText("2 tools could not be installed: jq, yq. About this instance says why."),
  ).toBeVisible();
  await expect(panel.getByText(/^online· running$/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Run again" })).toHaveCount(0);

  await panel.getByText("About this instance", { exact: true }).click();
  await expect(
    panel.getByText("ok · from the repository · 5m ago · took 12 seconds"),
  ).toBeVisible();
  await expect(panel.getByText("no script", { exact: true })).toBeVisible();
  await expect(panel.getByText("Already there: git-lfs, make")).toBeVisible();
  await expect(panel.getByText("Installed: gh, uv, ripgrep")).toBeVisible();
  await expect(
    panel.getByText("Failed: jq (apt could not find the package), yq (no release for this system)"),
  ).toBeVisible();
  await expect(
    panel.getByText("Skipped: tmux (needs sudo, which this instance does not have)"),
  ).toBeVisible();
});

test("says nothing of scripts or tools for an instance that reports neither", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page);
  await openWorkspace(page, "/dashboard/machines?view=cloud&state=online");

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("feature/search", { exact: true })).toBeVisible();
  await expect(panel.getByText(/could not be installed/)).toHaveCount(0);
  await panel.getByText("About this instance", { exact: true }).click();
  await expect(panel.getByText("Instance", { exact: true })).toBeVisible();
  await expect(panel.getByText("Install script", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/Scripts do not run/)).toHaveCount(0);
});

test("lists an instance whose script failed under what needs attention", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, {
    machines: machinesWith({
      hooks: hooks({ install: hookRun(), resume: timedOutResume }),
      // Missing tools are reported on the row, and need nobody.
      tools: toolsReport,
    }),
  });
  await page.goto("/dashboard/");

  const attention = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Needs your attention" }) });
  await expect(
    attention.getByText(
      "The install and resume scripts failed on the instance for feature/search of Widgets.",
    ),
  ).toBeVisible();
  await expect(
    attention.getByText("The instance is ready. Read what the script printed, then run it again."),
  ).toBeVisible();
  await expect(attention.getByText(/could not be installed/)).toHaveCount(0);

  await attention.getByRole("link", { name: "Open project" }).click();
  await expect(page).toHaveURL(detail);
  await expect(notice(page, "Install")).toContainText("The install script failed (exit 3).");
  await expect(notice(page, "Resume")).toContainText("The resume script ran out of time");
});

test("says GitHub is waiting for new permissions to be accepted", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { github: githubWaiting });
  await openWorkspace(page, "/dashboard/settings");

  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "GitHub" }) });
  await expect(
    card.getByText(
      "GitHub is waiting for you to accept new permissions for example. Until you do, gh in your instances cannot read issues, checks or workflow runs.",
    ),
  ).toBeVisible();
  const review = card.getByRole("link", { name: "Review on GitHub" });
  await expect(review).toHaveAttribute("href", githubWaiting.installations[0]?.manageUrl ?? "");
  await expect(review).toHaveAttribute("target", "_blank");
});

test("says nothing of permissions when none is waiting", async ({ page }) => {
  await signedIn(page);
  await mockPlaces(page, { github: githubAccepted });
  await openWorkspace(page, "/dashboard/settings");

  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "GitHub" }) });
  await expect(card.getByText("example", { exact: true })).toBeVisible();
  await expect(card.getByText(/waiting for you to accept/)).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Review on GitHub" })).toHaveCount(0);
});
