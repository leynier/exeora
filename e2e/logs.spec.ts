import { expect, test, type WebSocketRoute } from "@playwright/test";
import { mockApi, openWorkspace, project, signedIn, workspace } from "./dashboard-mock.js";

/** Answers the Logs view's socket, and hands the spec a way to send it lines. */
async function logsSocket(page: import("@playwright/test").Page) {
  const opened: string[] = [];
  let server: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/logs\/connect/, (socket) => {
    opened.push(socket.url());
    server = socket;
    socket.onMessage((message) => {
      if (String(message).includes('"heartbeat"')) socket.send('{"type":"heartbeat.ack"}');
    });
  });
  const send = (event: Record<string, unknown>) => {
    if (!server) throw new Error("the Logs view has not connected");
    server.send(JSON.stringify({ at: Date.now(), ...event }));
  };
  return { opened, send, connected: () => server !== undefined };
}

test("shows the calls on the workspace as they run, the way the CLI prints them", async ({
  page,
}) => {
  await signedIn(page);
  await mockApi(page);
  const socket = await logsSocket(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);

  await page.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}&view=logs`);
  await expect(page.getByText("live logs")).toBeVisible();
  await expect.poll(socket.connected).toBe(true);
  const log = page.getByRole("log", { name: "Calls on main" });
  await expect(log.getByText("Only this tab sees them")).toBeVisible();

  socket.send({
    type: "log.start",
    id: "req_1",
    kind: "tool",
    tool: "run_command",
    summary: "git status --short (in apps/web)",
    client: "claude-code 2.1.0",
  });
  await expect(log.getByText("git status --short (in apps/web)")).toBeVisible();
  await expect(log.getByText("· claude-code 2.1.0")).toBeVisible();
  await expect(page.getByText("· 1 running")).toBeVisible();

  socket.send({ type: "log.end", id: "req_1", tool: "run_command", ok: true, durationMs: 840 });
  socket.send({
    type: "log.start",
    id: "req_2",
    kind: "mcp",
    tool: "github/search_issues",
    summary: '{"q":"bug"}',
  });
  socket.send({
    type: "log.end",
    id: "req_2",
    tool: "github/search_issues",
    ok: false,
    durationMs: 12_400,
    errorCode: "TOOL_FAILED",
  });
  await expect(log.getByText("840ms")).toBeVisible();
  await expect(log.getByText("MCP github/search_issues")).toBeVisible();
  await expect(log.getByText("TOOL_FAILED")).toBeVisible();
  await expect(page.getByText("· 1 running")).toHaveCount(0);

  // Another view and back: the lines that arrived are still there.
  await page.getByRole("button", { name: "Source Control" }).click();
  socket.send({ type: "log.start", id: "req_3", kind: "tool", tool: "read_file", summary: "a.ts" });
  await page.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(log.getByText("git status --short (in apps/web)")).toBeVisible();
  await expect(log.getByText("a.ts", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clear the log" }).click();
  await expect(log.getByText("git status --short (in apps/web)")).toHaveCount(0);
  await expect(log.getByText("Only this tab sees them")).toBeVisible();
  expect(socket.opened).toHaveLength(1);
});

test("watches the workspace on screen, and starts over for another", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  const socket = await logsSocket(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&view=logs`);
  await expect.poll(() => socket.opened.length).toBe(1);
  socket.send({ type: "log.start", id: "req_root", kind: "tool", tool: "list_files", summary: "" });
  await expect(page.getByRole("log").getByText("list_files")).toBeVisible();

  await page.getByRole("button", { name: "Workspace main · default branch · Laptop" }).click();
  await page.getByRole("option", { name: "feature/trees · Laptop" }).click();
  await expect.poll(() => socket.opened.length).toBe(2);
  expect(new URL(socket.opened[1] ?? "").searchParams.get("workspace")).toBe(workspace.id);
  await expect(page.getByRole("log").getByText("list_files")).toHaveCount(0);
});
