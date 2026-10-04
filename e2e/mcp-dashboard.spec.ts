import { expect, type Page, test } from "@playwright/test";
import { mockApi, project, user } from "./dashboard-mock.js";
import { appRequest, changeHostContext, hostLog, openInHost, releaseHeld } from "./mcp-host.js";
import { relayGateway } from "./panel-relay.js";
import { mockWorkspaceV2 } from "./workspace-v2-mock.js";

/**
 * The full Dashboard behind the plugin's global entrypoint, framed by the
 * simulated MCP Apps host (not ChatGPT itself). It signs in on its own with
 * a device code; the gateway's OAuth endpoints are stood in for here, and the
 * page's own origin plays the gateway.
 */

const FULLSCREEN = { displayMode: "fullscreen", availableDisplayModes: ["fullscreen"] };

async function mockDeviceLogin(page: Page, options: { deny?: boolean } = {}) {
  const sent: { path: string; body: Record<string, string>; auth: string | null }[] = [];
  let polls = 0;
  await page.route(/\/oauth\/(sideapp-client|device\/code|device\/token|token)$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = Object.fromEntries(new URLSearchParams(request.postData() ?? ""));
    sent.push({ path: url.pathname, body, auth: request.headers().authorization ?? null });
    const origin = url.origin;
    switch (url.pathname) {
      case "/oauth/sideapp-client":
        return route.fulfill({ json: { client_id: "exeora-sideapp" } });
      case "/oauth/device/code":
        return route.fulfill({
          json: {
            device_code: "device-1",
            user_code: "WXYZ-2345",
            verification_uri: `${origin}/oauth/device`,
            expires_in: 600,
            interval: 1,
          },
        });
      case "/oauth/device/token":
        polls += 1;
        if (options.deny) return route.fulfill({ status: 400, json: { error: "access_denied" } });
        if (polls < 2) {
          return route.fulfill({ status: 400, json: { error: "authorization_pending" } });
        }
        return route.fulfill({
          json: {
            authorization_code: "auth-1",
            redirect_uri: `${origin}/oauth/device/sideapp-callback`,
            iss: origin,
          },
        });
      default:
        return route.fulfill({
          json: { access_token: "sideapp-token", token_type: "Bearer", expires_in: 3600 },
        });
    }
  });
  return sent;
}

async function openDashboard(page: Page, options: { deny?: boolean; deepLink?: string } = {}) {
  const apiAuth: (string | null)[] = [];
  await mockApi(page, {
    onRequest: (request) => apiAuth.push(request.headers().authorization ?? null),
  });
  const oauth = await mockDeviceLogin(page, options);
  const frame = await openInHost(page, {
    context: options.deepLink
      ? { ...FULLSCREEN, "openai/deepLink": { url: options.deepLink } }
      : FULLSCREEN,
    resource: "/dashboard/mcp-dashboard.html",
    sameOrigin: true,
  });
  return { frame, oauth, apiAuth };
}

test("signs in with a code, then runs the whole dashboard in the frame", async ({ page }) => {
  const { frame, oauth, apiAuth } = await openDashboard(page);

  await expect(
    frame.getByRole("heading", { name: "Sign in to the Exeora Dashboard" }),
  ).toBeVisible();
  expect(apiAuth).toEqual([]);
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(frame.getByLabel("Sign-in code")).toHaveText("WXYZ-2345");
  await expect
    .poll(async () => (await hostLog(page)).links)
    .toEqual([`${new URL(page.url()).origin}/oauth/device`]);

  // Approved on the gateway's page; the frame carries on by itself.
  await expect(frame.getByRole("link", { name: "Projects", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const exchange = oauth.find((item) => item.path === "/oauth/token");
  expect(exchange?.body).toMatchObject({
    grant_type: "authorization_code",
    client_id: "exeora-sideapp",
    code: "auth-1",
    redirect_uri: `${new URL(page.url()).origin}/oauth/device/sideapp-callback`,
  });
  expect(oauth.find((item) => item.path === "/oauth/device/code")?.body).toMatchObject({
    scope: "dashboard:manage",
    code_challenge_method: "S256",
  });
  // Its own token, never the MCP connection's.
  expect(apiAuth.length).toBeGreaterThan(0);
  expect(new Set(apiAuth)).toEqual(new Set(["Bearer sideapp-token"]));

  // The dashboard's own routes, moved around in memory.
  await frame.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(frame.getByRole("link", { name: project.name }).first()).toBeVisible();
  await frame.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(frame.getByText(user.email).first()).toBeVisible();

  // Signing out ends it here: back to the code screen, the token gone.
  await frame.getByRole("button", { name: "Sign out" }).click();
  await expect(
    frame.getByRole("heading", { name: "Sign in to the Exeora Dashboard" }),
  ).toBeVisible();
  const kept = await page.evaluate(() => sessionStorage.getItem("exeora.sideapp.access_token"));
  expect(kept).toBeNull();
  const before = apiAuth.length;
  await page.waitForTimeout(300);
  expect(apiAuth.length).toBe(before);
});

test("says so when signing in is declined, and can start again", async ({ page }) => {
  const { frame } = await openDashboard(page, { deny: true });
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(frame.getByRole("alert")).toHaveText("Signing in was declined.", {
    timeout: 10_000,
  });
  await expect(frame.getByRole("button", { name: "Sign in with a code" })).toBeEnabled();
});

test("cancelling stops the poll", async ({ page }) => {
  const { frame, oauth } = await openDashboard(page);
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(frame.getByLabel("Sign-in code")).toBeVisible();
  await frame.getByRole("button", { name: "Cancel" }).click();
  const polls = oauth.filter((item) => item.path === "/oauth/device/token").length;
  await page.waitForTimeout(2_500);
  expect(oauth.filter((item) => item.path === "/oauth/device/token").length).toBe(polls);
  expect(oauth.some((item) => item.path === "/oauth/token")).toBe(false);
  await expect(frame.getByRole("button", { name: "Sign in with a code" })).toBeVisible();
});

async function signIn(page: Page) {
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(frame.getByLabel("Sign-in code")).toBeVisible();
  await expect(frame.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 10_000 });
}

test("keeps a deep link through signing in, and follows a later one", async ({ page }) => {
  const { frame } = await openDashboard(page, { deepLink: "/dashboard/settings" });
  await expect(
    frame.getByRole("heading", { name: "Sign in to the Exeora Dashboard" }),
  ).toBeVisible();
  await signIn(page);
  await expect(frame.getByText(user.email).first()).toBeVisible();
  await expect(frame.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

  await changeHostContext(page, { "openai/deepLink": { url: "/projects" } });
  await expect(frame.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await expect(frame.getByRole("link", { name: project.name }).first()).toBeVisible();
});

test("never runs the browser's sign-in callback in the frame", async ({ page }) => {
  const { frame, oauth } = await openDashboard(page, {
    deepLink: "/callback?code=stolen&state=whatever",
  });
  await expect(
    frame.getByRole("heading", { name: "Sign in to the Exeora Dashboard" }),
  ).toBeVisible();
  await expect(frame.getByText("did not match the request")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(oauth).toEqual([]);
});

test("connects GitHub in the browser and stays in the frame", async ({ page }) => {
  const connectUrl = "https://github.com/apps/exeora/installations/new?state=signed";
  const { frame } = await openDashboard(page);
  await page.route("**/api/github", (route) =>
    route.fulfill({
      json: { enabled: true, connected: false, installations: [], connectUrl },
    }),
  );
  await signIn(page);
  await frame.getByRole("link", { name: "Settings", exact: true }).click();
  await frame.getByRole("button", { name: "Connect GitHub" }).first().click();
  await expect(frame.getByText("Finish connecting in the browser")).toBeVisible();
  await expect.poll(async () => (await hostLog(page)).links).toContain(connectUrl);
  await expect(frame.getByRole("button", { name: "Connect GitHub" }).first()).toBeEnabled();
});

test("adds Workspace comments to the conversation from the Dashboard in ChatGPT", async ({
  page,
}) => {
  await mockWorkspaceV2(page);
  await mockDeviceLogin(page);
  const frame = await openInHost(page, {
    context: FULLSCREEN,
    resource: "/dashboard/mcp-dashboard.html",
    sameOrigin: true,
  });
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  await expect(frame.getByRole("link", { name: "Workspace", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await frame.getByRole("link", { name: "Workspace", exact: true }).click();
  await frame.getByRole("button", { name: "Explorer" }).first().click();
  const files = frame.getByRole("tree", { name: "Files" });
  await files.getByRole("treeitem", { name: "src" }).click();
  await files.getByRole("treeitem", { name: "main.ts" }).click();
  const editor = frame.locator(".cm-content");
  await expect(editor).toContainText("export const answer = 42;");
  await editor.locator(".cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await frame.getByRole("button", { name: "Comment on the selection" }).click();
  const composer = frame.getByRole("dialog", { name: "Comment on the selection" });
  await composer.getByLabel("Comment").fill("From the Dashboard app");
  await composer.getByRole("button", { name: "Add comment" }).click();
  await frame.getByRole("button", { name: "Comments, 1 waiting" }).click();
  const review = frame.getByRole("dialog", { name: "Comments" });
  await review.getByRole("button", { name: "Add to context" }).click();
  await expect(review.getByRole("region", { name: "Attached to context" })).toBeVisible();
  expect((await hostLog(page)).modelContexts.at(-1)?.content?.[0]?.text).toContain(
    "Comment: From the Dashboard app",
  );
});

test("does not restore drafts from widget state for whoever signs in next", async ({ page }) => {
  await mockWorkspaceV2(page);
  await mockDeviceLogin(page);
  const draft = {
    id: "left-behind",
    source: {
      kind: "file",
      projectId: project.id,
      workspace: null,
      path: "src/main.ts",
      version: "tok1",
      unsaved: false,
      start: { line: 1, column: 1 },
      end: { line: 1, column: 6 },
    },
    snippet: "export",
    comment: "Another account's draft",
    createdAt: 1,
  };
  const frame = await openInHost(page, {
    context: FULLSCREEN,
    resource: "/dashboard/mcp-dashboard.html",
    sameOrigin: true,
    widgetState: { privateContent: { exeoraComments: { v: 1, drafts: [draft] } } },
  });
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  await frame.getByRole("link", { name: "Workspace", exact: true }).click({ timeout: 10_000 });
  await expect(frame.getByRole("button", { name: "Comments, 0 waiting" })).toBeVisible();
  await expect(frame.getByText("Another account's draft")).toHaveCount(0);
});

const PANEL = "5c4b3a29-1807-4f6e-8d5c-4b3a29180706";

/** The Dashboard opened with a panel id, a relay, and a pairing route answering `pair`. */
/** The resolver's answer naming the Workspace on `path`. */
const destination = (path: string, extra: Record<string, unknown> = {}) => ({
  structuredContent: {
    projectId: project.id,
    workspace: null,
    tab: "explorer",
    path,
    panelId: PANEL,
  },
  ...extra,
});

async function openRelayedDashboard(
  page: Page,
  pair: (body: Record<string, unknown>) => { status: number; json: unknown },
  answers: Record<string, unknown>[] = [destination("src/main.ts")],
) {
  await mockWorkspaceV2(page);
  await mockDeviceLogin(page);
  const gateway = await relayGateway(page);
  const pairings: { auth: string | null; body: Record<string, unknown> }[] = [];
  await page.route("**/api/panel-relay/ticket", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    pairings.push({ auth: route.request().headers().authorization ?? null, body });
    await route.fulfill(pair(body));
  });
  const frame = await openInHost(page, {
    context: FULLSCREEN,
    resource: "/dashboard/mcp-dashboard.html",
    sameOrigin: true,
    result: { structuredContent: { panelId: PANEL } },
    relay: { panelId: PANEL },
    tools: { exeora_panel_resolve_navigation: answers },
  });
  return { frame, gateway, pairings };
}

const tickets = async (page: Page) =>
  (await hostLog(page)).calls.filter((call) => call.name === "exeora_panel_relay_ticket");

test("lets ChatGPT move its Workspace only once its own sign-in is paired, until signing out", async ({
  page,
}) => {
  // The page plays the gateway; its origin is known once the host is open.
  let origin = "";
  const { frame, gateway, pairings } = await openRelayedDashboard(page, () => ({
    status: 200,
    json: {
      panelId: PANEL,
      protocol: 1,
      url: `${origin}/relay-socket?ticket=paired`,
      expiresAt: Date.now() + 60_000,
    },
  }));
  origin = new URL(page.url()).origin;
  // Signed out, ChatGPT controls nothing here and nothing is asked for.
  await expect(
    frame.getByRole("heading", { name: "Sign in to the Exeora Dashboard" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(await tickets(page)).toEqual([]);
  expect(gateway.sockets).toHaveLength(0);
  await expect(frame.getByRole("region", { name: "ChatGPT control" })).toHaveCount(0);

  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  const socket = await gateway.connect(0, PANEL);
  expect((await tickets(page))[0]?.arguments).toEqual({
    panelId: PANEL,
    origin,
    surface: "dashboard",
  });
  // The pairing ticket went to the gateway with the Dashboard's own sign-in.
  expect(pairings).toEqual([
    { auth: "Bearer sideapp-token", body: { panelId: PANEL, ticket: "pair-1", origin } },
  ]);
  const chip = frame.getByRole("region", { name: "ChatGPT control" });
  await expect(chip.getByRole("status")).toHaveText("ChatGPT can move this panel");

  const moved = await gateway.call(socket, PANEL, "navigate", {
    project: project.id,
    path: "src/main.ts",
  });
  expect(moved).toMatchObject({ status: "applied", state: { path: "src/main.ts" } });
  await expect(frame.locator(".cm-content")).toContainText("export const answer = 42;");
  await expect
    .poll(async () => (await hostLog(page)).contexts.at(-1)?.["exeora/workspace"])
    .toMatchObject({ panelId: PANEL, relay: "connected", path: "src/main.ts" });

  // Elsewhere in the Dashboard, no Workspace is described as shown.
  await frame.getByRole("link", { name: "Projects", exact: true }).click();
  await expect
    .poll(async () => (await gateway.call(socket, PANEL, "get_state")).state)
    .toMatchObject({ projectId: null, tab: null, path: null });

  // Signing out ends the control with the session, and nothing reconnects.
  await frame.getByRole("link", { name: "Settings", exact: true }).click();
  await frame.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(() => socket.closed).not.toBeNull();
  await expect(chip).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(gateway.sockets).toHaveLength(1);
  expect(pairings).toHaveLength(1);
});

test("leaves ChatGPT without control when the Dashboard is signed in as another account", async ({
  page,
}) => {
  const { frame, gateway, pairings } = await openRelayedDashboard(page, () => ({
    status: 403,
    json: { error: "forbidden" },
  }));
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  const chip = frame.getByRole("region", { name: "ChatGPT control" });
  await expect(chip.getByRole("status")).toHaveText(/another Exeora account/, {
    timeout: 10_000,
  });
  await expect(chip.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(pairings).toHaveLength(1);
  expect(gateway.sockets).toHaveLength(0);
});

test("lands no move the model asked for once the person has gone elsewhere in the Dashboard", async ({
  page,
}) => {
  let origin = "";
  const { frame, gateway } = await openRelayedDashboard(
    page,
    () => ({
      status: 200,
      json: {
        panelId: PANEL,
        protocol: 1,
        url: `${origin}/relay-socket?ticket=paired`,
        expiresAt: Date.now() + 60_000,
      },
    }),
    [
      destination("src/main.ts"),
      destination("readme.md", { held: true }),
      destination("src/main.ts", { held: true }),
    ],
  );
  origin = new URL(page.url()).origin;
  const resolutions = async () =>
    (await hostLog(page)).calls.filter((call) => call.name === "exeora_panel_resolve_navigation")
      .length;
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  const socket = await gateway.connect(0, PANEL);
  const editor = frame.locator(".cm-content");
  expect(
    await gateway.call(socket, PANEL, "navigate", { project: project.id, path: "src/main.ts" }),
  ).toMatchObject({ status: "applied" });
  await expect(editor).toContainText("export const answer = 42;");

  // The model asks to move; while the gateway checks, the person leaves for Projects.
  const fromWorkspace = gateway.send(socket, PANEL, "navigate", { path: "readme.md" });
  await expect.poll(resolutions).toBe(2);
  await frame.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(frame.getByRole("link", { name: project.name }).first()).toBeVisible();
  await releaseHeld(page);
  await expect.poll(() => gateway.replies(socket, fromWorkspace).length).toBe(1);
  expect(gateway.replies(socket, fromWorkspace)[0]?.result).toMatchObject({
    status: "superseded",
    state: { projectId: null, path: null },
  });
  await page.waitForTimeout(300);
  await expect(editor).toHaveCount(0);
  await expect(frame.getByRole("link", { name: project.name }).first()).toBeVisible();

  // From Projects the model asks again; the person goes on to Settings.
  const fromProjects = gateway.send(socket, PANEL, "navigate", {
    project: project.id,
    path: "src/main.ts",
  });
  await expect.poll(resolutions).toBe(3);
  await frame.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(frame.getByText(user.email).first()).toBeVisible();
  await releaseHeld(page);
  await expect.poll(() => gateway.replies(socket, fromProjects).length).toBe(1);
  expect(gateway.replies(socket, fromProjects)[0]?.result).toMatchObject({
    status: "superseded",
  });
  await page.waitForTimeout(300);
  await expect(editor).toHaveCount(0);
  await expect(frame.getByText(user.email).first()).toBeVisible();
});

test("ends ChatGPT's control, and never pairs again, once the host tears the Dashboard down", async ({
  page,
}) => {
  let origin = "";
  const { frame, gateway, pairings } = await openRelayedDashboard(page, () => ({
    status: 200,
    json: {
      panelId: PANEL,
      protocol: 1,
      url: `${origin}/relay-socket?ticket=paired`,
      expiresAt: Date.now() + 60_000,
    },
  }));
  origin = new URL(page.url()).origin;
  await frame.getByRole("button", { name: "Sign in with a code" }).click();
  const socket = await gateway.connect(0, PANEL);
  await appRequest(page, "ui/resource-teardown", {});
  await expect.poll(() => socket.closed).not.toBeNull();
  await expect(frame.getByRole("region", { name: "ChatGPT control" })).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(gateway.sockets).toHaveLength(1);
  expect(pairings).toHaveLength(1);
  await expect
    .poll(async () => (await hostLog(page)).modelContexts.at(-1)?.structuredContent)
    .toEqual({});
});
