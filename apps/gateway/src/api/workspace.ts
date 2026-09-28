import {
  ExeoraError,
  isWorkspaceRead,
  SOURCE_CONTROL_V1,
  SOURCE_CONTROL_V2,
  WORKSPACE_V2,
  WorkspaceAction,
} from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { beginAudit, finishAudit } from "../audit.js";
import { db, schema } from "../db/client.js";
import { rootSelector } from "../location-roots.js";
import { locationsOf } from "../locations.js";
import { firstPartyOrigin } from "../oauth/clients.js";
import { uiClientName } from "../props.js";
import { isCloudMachine } from "../workspace-placement.js";
import { relayName } from "./ops.js";
import type { ApiEnv } from "./router.js";
import { dispatch, ownedTarget, targetQuery, workspaceError } from "./workspace-target.js";

export const workspace = new Hono<ApiEnv>();

const diffQuery = targetQuery.extend({
  path: z.string().min(1).max(4_096),
  area: z.enum(["working", "staged"]).default("working"),
});

workspace.get(
  "/api/projects/:id/workspace/capabilities",
  zValidator("query", targetQuery),
  async (c) => {
    const target = await ownedTarget(
      c.env,
      c.get("userId"),
      c.req.param("id"),
      c.req.valid("query").workspace,
    );
    if (!target) return c.json({ error: "not_found" }, 404);
    const capabilities = await c.env.DEVICE_RELAY.getByName(
      relayName(c.get("userId"), target.deviceId),
    ).capabilities({ wake: true });
    const workspaceRouting = capabilities?.workspaceRouting ?? false;
    const routable = !target.workspaceId || workspaceRouting;
    // Each tab of the dashboard has a feature of its own to degrade on, so
    // an older CLI keeps its Source Control while the Explorer asks for an
    // update. The Explorer and search arrived together, under one feature.
    const has = (feature: string) =>
      routable && (capabilities?.features?.includes(feature) ?? false);
    return c.json({
      online: capabilities !== null,
      sourceControl: has(SOURCE_CONTROL_V1),
      sourceControlV2: has(SOURCE_CONTROL_V2),
      files: has(WORKSPACE_V2),
      search: has(WORKSPACE_V2),
      terminal: has("terminal-v1"),
      workspaceRouting,
    });
  },
);

workspace.get("/api/projects/:id/workspace/status", zValidator("query", targetQuery), async (c) =>
  runRead(c, { action: "status" }, c.req.valid("query").workspace),
);

workspace.get("/api/projects/:id/workspace/diff", zValidator("query", diffQuery), async (c) => {
  const { workspace: ws, ...action } = c.req.valid("query");
  return runRead(c, { action: "diff", ...action }, ws);
});

workspace.post(
  "/api/projects/:id/workspace/actions",
  zValidator("query", targetQuery),
  zValidator("json", WorkspaceAction),
  async (c) => {
    const action = c.req.valid("json");
    // Reads are neither audited nor counted as writes; they have a route of
    // their own. What the remote lacks is the gateway's own question.
    if (isWorkspaceRead(action.action) || action.action === "unpublished") {
      return c.json({ error: "use_read_endpoint" }, 400);
    }
    const userId = c.get("userId");
    const projectId = c.req.param("id");
    const target = await ownedTarget(c.env, userId, projectId, c.req.valid("query").workspace);
    if (!target) return c.json({ error: "not_found" }, 404);
    // On Exeora Cloud a workspace is a machine, and the machine that would
    // run this action has no worktrees to create. `POST …/workspaces` makes
    // one wherever it is asked to; this route only reaches the user's own.
    if (action.action === "workspace_create" && (await isCloudMachine(c.env, target.deviceId))) {
      return c.json({ error: "use_cloud_api" }, 400);
    }
    // Preparing a copy is what the gateway asks of a machine, never a page.
    if (action.action === "project_prepare") return c.json({ error: "not_found" }, 404);
    const audit = await beginAudit(c.env, {
      userId,
      projectId,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
      workspaceSlug: target.recordedAs,
      tool: `source_control.${action.action}`,
      endpoint: "dashboard",
      caller: { clientId: undefined, clientName: uiClientName(c.executionCtx), mcp: undefined },
    });
    try {
      const value = await dispatch(c.env, userId, projectId, target, action, c.req.raw.signal);
      await finishAudit(c.env, audit, { status: "ok" });
      return c.json(value);
    } catch (error) {
      const code = error instanceof ExeoraError ? error.code : "INTERNAL_ERROR";
      await finishAudit(c.env, audit, { status: "error", errorCode: code });
      return workspaceError(c, error);
    }
  },
);

workspace.get("/api/terminals", async (c) => {
  const userId = c.get("userId");
  const devices = await db(c.env)
    .select({ id: schema.devices.id })
    .from(schema.devices)
    .where(and(eq(schema.devices.userId, userId), isNull(schema.devices.revokedAt)))
    .all();
  // One unreachable relay must not hide every other machine's terminals.
  const results = await Promise.allSettled(
    devices.map((device) =>
      c.env.DEVICE_RELAY.getByName(relayName(userId, device.id)).listTerminals(),
    ),
  );
  const listed = results.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value.map((terminal) => ({ terminal, deviceId: devices[index]?.id }));
    }
    console.error("listing terminals failed", result.reason);
    return [];
  });

  // A terminal in a project root names no workspace, and a root is in one
  // location or another. The machine that holds the terminal says which, so
  // the root of the desktop is not listed as the default's.
  const roots = listed.filter(({ terminal }) => !terminal.workspaceId);
  const places =
    roots.length === 0
      ? new Map<string, string>()
      : await rootSelectors(c.env, userId, [
          ...new Set(roots.map(({ terminal }) => terminal.projectId)),
        ]);

  return c.json({
    items: listed.map(({ terminal, deviceId }) => {
      if (terminal.workspaceId) return terminal;
      const selector = places.get(`${terminal.projectId}:${deviceId}`);
      return selector ? { ...terminal, workspaceSlug: selector } : terminal;
    }),
  });
});

/** The selector of each location's root other than the default, by project and machine. */
async function rootSelectors(
  env: Pick<Env, "DB">,
  userId: string,
  projectIds: string[],
): Promise<Map<string, string>> {
  const projects = await db(env)
    .select({
      id: schema.projects.id,
      deviceId: schema.projects.deviceId,
      localPath: schema.projects.localPath,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, userId), inArray(schema.projects.id, projectIds)))
    .all();
  const locations = await locationsOf(env, userId, projects);
  const selectors = new Map<string, string>();
  for (const project of projects) {
    for (const location of locations.get(project.id) ?? []) {
      if (location.default || location.deviceId === null) continue;
      selectors.set(`${project.id}:${location.deviceId}`, rootSelector(location.slug));
    }
  }
  return selectors;
}

workspace.delete("/api/projects/:id/terminal", zValidator("query", targetQuery), async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const target = await ownedTarget(c.env, userId, projectId, c.req.valid("query").workspace);
  if (!target) return c.json({ error: "not_found" }, 404);
  const closed = await c.env.DEVICE_RELAY.getByName(
    relayName(userId, target.deviceId),
  ).closeTerminal(projectId, target.workspaceId);
  return c.json({ closed });
});

workspace.post("/api/projects/:id/terminal-ticket", zValidator("query", targetQuery), async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const target = await ownedTarget(c.env, userId, projectId, c.req.valid("query").workspace);
  if (!target) return c.json({ error: "not_found" }, 404);
  const relay = c.env.DEVICE_RELAY.getByName(relayName(userId, target.deviceId));
  // Bound to the UI that asked: the dashboard's socket, and the side panel's
  // now that the extension frames it from here, come from the gateway's
  // origin; a side panel from before that, bundled in the extension, from the
  // extension's. A request from neither still gets the gateway's.
  const origin =
    firstPartyOrigin(c.env, c.req.header("Origin")) ?? new URL(c.env.EXEORA_BASE_URL).origin;
  const ticket = await relay.createTerminalTicket(
    projectId,
    target.workspaceId,
    target.workspaceSlug,
    origin,
  );
  if (!ticket) {
    return c.json(
      { error: "terminal_unavailable", message: "Connect or update the Exeora CLI." },
      409,
    );
  }
  const audit = await beginAudit(c.env, {
    userId,
    projectId,
    ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
    workspaceSlug: target.recordedAs,
    tool: "terminal.open",
    endpoint: "dashboard",
    caller: { clientId: undefined, clientName: uiClientName(c.executionCtx), mcp: undefined },
  });
  await finishAudit(c.env, audit, { status: "ok" });
  return c.json({
    url: socketUrl(c.env, "/terminal/connect", projectId, target, ticket),
    expiresInMs: 30_000,
  });
});

/**
 * A ticket to watch, live, the calls agents make on a root or workspace. Not
 * audited and never wakes the machine: watching changes nothing there, and
 * what is watched is what the audit already records as it happens.
 */
workspace.post("/api/projects/:id/logs-ticket", zValidator("query", targetQuery), async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const target = await ownedTarget(c.env, userId, projectId, c.req.valid("query").workspace);
  if (!target) return c.json({ error: "not_found" }, 404);
  const relay = c.env.DEVICE_RELAY.getByName(relayName(userId, target.deviceId));
  const origin =
    firstPartyOrigin(c.env, c.req.header("Origin")) ?? new URL(c.env.EXEORA_BASE_URL).origin;
  const ticket = await relay.createLogsTicket(
    projectId,
    target.workspaceId,
    target.workspaceSlug,
    origin,
  );
  if (!ticket) return c.json({ error: "logs_unavailable" }, 409);
  return c.json({
    url: socketUrl(c.env, "/logs/connect", projectId, target, ticket),
    expiresInMs: 30_000,
  });
});

/** Where a dashboard tab opens its socket to the machine, with the ticket it spends. */
function socketUrl(
  env: Pick<Env, "EXEORA_BASE_URL">,
  path: "/terminal/connect" | "/logs/connect",
  projectId: string,
  target: {
    deviceId: string;
    workspaceId?: string | undefined;
    workspaceSlug?: string | undefined;
  },
  ticket: string,
): string {
  const url = new URL(path, env.EXEORA_BASE_URL);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("deviceId", target.deviceId);
  if (target.workspaceId) url.searchParams.set("workspaceId", target.workspaceId);
  if (target.workspaceSlug) url.searchParams.set("workspaceSlug", target.workspaceSlug);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

async function runRead(
  c: Context<ApiEnv>,
  action: Extract<z.infer<typeof WorkspaceAction>, { action: "status" | "diff" }>,
  selector?: string,
) {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  if (!projectId) return c.json({ error: "not_found" }, 404);
  const target = await ownedTarget(c.env, userId, projectId, selector);
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    return c.json(await dispatch(c.env, userId, projectId, target, action, c.req.raw.signal));
  } catch (error) {
    return workspaceError(c, error);
  }
}
