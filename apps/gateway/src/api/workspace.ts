import { ExeoraError, WorkspaceAction, type WorkspaceValue } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { beginAudit, finishAudit } from "../audit.js";
import { db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import {
  defaultRootSelector,
  ROOT_SELECTOR,
  resolveLocationRoot,
  rootLocation,
  rootSelector,
} from "../location-roots.js";
import { locationsOf } from "../locations.js";
import { callRelayWorkspace } from "../relay-client.js";
import { isCloudMachine } from "../workspace-placement.js";
import { relayName } from "./ops.js";
import type { ApiEnv } from "./router.js";

export const workspace = new Hono<ApiEnv>();

const targetQuery = z.object({ workspace: z.string().min(1).max(128).optional() });
const diffQuery = targetQuery.extend({
  path: z.string().min(1).max(4_096),
  area: z.enum(["working", "staged"]).default("working"),
});

type ResolvedTarget = {
  deviceId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  /** What the audit trail keeps: the workspace, or the root with its location. */
  recordedAs: string;
};

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
    return c.json({
      online: capabilities !== null,
      sourceControl: routable && (capabilities?.features?.includes("source-control-v1") ?? false),
      terminal: routable && (capabilities?.features?.includes("terminal-v1") ?? false),
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
    if (action.action === "status" || action.action === "diff" || action.action === "unpublished") {
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
      caller: { clientId: undefined, clientName: "Exeora Dashboard", mcp: undefined },
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
  const origin = new URL(c.env.EXEORA_BASE_URL).origin;
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
    caller: { clientId: undefined, clientName: "Exeora Dashboard", mcp: undefined },
  });
  await finishAudit(c.env, audit, { status: "ok" });
  const url = new URL("/terminal/connect", c.env.EXEORA_BASE_URL);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("deviceId", target.deviceId);
  const { workspaceId, workspaceSlug } = target;
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  if (workspaceSlug) url.searchParams.set("workspaceSlug", workspaceSlug);
  url.searchParams.set("ticket", ticket);
  return c.json({ url: url.toString(), expiresInMs: 30_000 });
});

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

async function dispatch(
  env: Env,
  userId: string,
  projectId: string,
  target: ResolvedTarget,
  action: z.infer<typeof WorkspaceAction>,
  signal: AbortSignal,
): Promise<WorkspaceValue> {
  return callRelayWorkspace(env.DEVICE_RELAY.getByName(relayName(userId, target.deviceId)), {
    requestId: newId("req"),
    projectId,
    workspaceId: target.workspaceId,
    workspaceSlug: target.workspaceSlug,
    action,
    signal,
  });
}

async function ownedTarget(
  env: Env,
  userId: string,
  projectId: string,
  selector?: string,
): Promise<ResolvedTarget | null> {
  const project = await db(env)
    .select({
      deviceId: schema.projects.deviceId,
      removedAt: schema.devices.revokedAt,
    })
    .from(schema.projects)
    .innerJoin(schema.devices, eq(schema.projects.deviceId, schema.devices.id))
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
        eq(schema.devices.userId, userId),
      ),
    )
    .get();
  if (!project) return null;
  // Only the project root needs the default location's machine. A workspace
  // on another machine is served there whatever became of the default.
  if (!selector || selector === ROOT_SELECTOR) {
    if (project.removedAt !== null) return null;
    return {
      deviceId: project.deviceId,
      recordedAs: await defaultRootSelector(env, projectId),
    };
  }
  // The root of another location: the same kind of call, to the machine that
  // holds that copy, and with no workspace named either.
  const location = rootLocation(selector);
  if (location !== null) {
    const root = await resolveLocationRoot(env, projectId, location).catch(() => null);
    return root ? { deviceId: root.deviceId, recordedAs: root.slug } : null;
  }

  const ws = await db(env)
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      deviceId: schema.workspaces.deviceId,
      deviceRevokedAt: schema.devices.revokedAt,
    })
    .from(schema.workspaces)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.workspaces.deviceId))
    .where(
      and(
        eq(schema.workspaces.projectId, projectId),
        or(eq(schema.workspaces.id, selector), eq(schema.workspaces.slug, selector)),
      ),
    )
    .get();
  if (!ws) return null;
  // A workspace is served by the machine that holds it and nowhere else;
  // once that machine is revoked the workspace is gone with it.
  if (ws.deviceId !== null && ws.deviceRevokedAt !== null) return null;
  if (ws.deviceId === null && project.removedAt !== null) return null;
  return {
    deviceId: ws.deviceId ?? project.deviceId,
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    recordedAs: ws.slug,
  };
}

function workspaceError(c: Context<ApiEnv>, error: unknown) {
  if (error instanceof ExeoraError) {
    const status =
      error.code === "LOCAL_EXECUTOR_OFFLINE" ||
      error.code === "EXECUTOR_WAKING" ||
      error.code === "UNKNOWN_WORKSPACE" ||
      error.code === "WORKSPACE_UNAVAILABLE"
        ? 409
        : error.code === "FORBIDDEN"
          ? 403
          : 422;
    return c.json({ error: error.code, message: error.message }, status);
  }
  console.error("workspace request failed", error);
  return c.json({ error: "INTERNAL_ERROR", message: "Workspace request failed." }, 500);
}
