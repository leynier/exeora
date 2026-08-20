import { ExeoraError, WorkspaceAction, type WorkspaceValue } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { beginAudit, finishAudit } from "../audit.js";
import { db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import { callRelayWorkspace } from "../relay-client.js";
import { relayName } from "./ops.js";
import type { ApiEnv } from "./router.js";

export const workspace = new Hono<ApiEnv>();

const targetQuery = z.object({ worktree: z.string().min(1).max(128).optional() });
const diffQuery = targetQuery.extend({
  path: z.string().min(1).max(4_096),
  area: z.enum(["working", "staged"]).default("working"),
});

type ResolvedTarget = {
  deviceId: string;
  worktreeId?: string;
  worktreeSlug?: string;
};

workspace.get(
  "/api/projects/:id/workspace/capabilities",
  zValidator("query", targetQuery),
  async (c) => {
    const target = await ownedTarget(
      c.env,
      c.get("userId"),
      c.req.param("id"),
      c.req.valid("query").worktree,
    );
    if (!target) return c.json({ error: "not_found" }, 404);
    const capabilities = await c.env.DEVICE_RELAY.getByName(
      relayName(c.get("userId"), target.deviceId),
    ).capabilities();
    const worktreeRouting = capabilities?.worktreeRouting ?? false;
    const routable = !target.worktreeId || worktreeRouting;
    return c.json({
      online: capabilities !== null,
      sourceControl: routable && (capabilities?.features?.includes("source-control-v1") ?? false),
      terminal: routable && (capabilities?.features?.includes("terminal-v1") ?? false),
      worktreeRouting,
    });
  },
);

workspace.get("/api/projects/:id/workspace/status", zValidator("query", targetQuery), async (c) =>
  runRead(c, { action: "status" }, c.req.valid("query").worktree),
);

workspace.get("/api/projects/:id/workspace/diff", zValidator("query", diffQuery), async (c) => {
  const { worktree, ...action } = c.req.valid("query");
  return runRead(c, { action: "diff", ...action }, worktree);
});

workspace.post(
  "/api/projects/:id/workspace/actions",
  zValidator("query", targetQuery),
  zValidator("json", WorkspaceAction),
  async (c) => {
    const action = c.req.valid("json");
    if (action.action === "status" || action.action === "diff") {
      return c.json({ error: "use_read_endpoint" }, 400);
    }
    const userId = c.get("userId");
    const projectId = c.req.param("id");
    const target = await ownedTarget(c.env, userId, projectId, c.req.valid("query").worktree);
    if (!target) return c.json({ error: "not_found" }, 404);
    const audit = await beginAudit(c.env, {
      userId,
      projectId,
      ...(target.worktreeId ? { worktreeId: target.worktreeId } : {}),
      ...(target.worktreeSlug ? { worktreeSlug: target.worktreeSlug } : {}),
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

workspace.post("/api/projects/:id/terminal-ticket", zValidator("query", targetQuery), async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("id");
  const target = await ownedTarget(c.env, userId, projectId, c.req.valid("query").worktree);
  if (!target) return c.json({ error: "not_found" }, 404);
  const relay = c.env.DEVICE_RELAY.getByName(relayName(userId, target.deviceId));
  const origin = new URL(c.env.EXEORA_BASE_URL).origin;
  const ticket = await relay.createTerminalTicket(
    projectId,
    target.worktreeId,
    target.worktreeSlug,
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
    ...(target.worktreeId ? { worktreeId: target.worktreeId } : {}),
    ...(target.worktreeSlug ? { worktreeSlug: target.worktreeSlug } : {}),
    tool: "terminal.open",
    endpoint: "dashboard",
    caller: { clientId: undefined, clientName: "Exeora Dashboard", mcp: undefined },
  });
  await finishAudit(c.env, audit, { status: "ok" });
  const url = new URL("/terminal/connect", c.env.EXEORA_BASE_URL);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("deviceId", target.deviceId);
  const { worktreeId, worktreeSlug } = target;
  if (worktreeId) url.searchParams.set("worktreeId", worktreeId);
  if (worktreeSlug) url.searchParams.set("worktreeSlug", worktreeSlug);
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
    worktreeId: target.worktreeId,
    worktreeSlug: target.worktreeSlug,
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
    .select({ deviceId: schema.projects.deviceId })
    .from(schema.projects)
    .innerJoin(schema.devices, eq(schema.projects.deviceId, schema.devices.id))
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
        eq(schema.devices.userId, userId),
        isNull(schema.devices.revokedAt),
      ),
    )
    .get();
  if (!project) return null;
  if (!selector || selector === "main") return { deviceId: project.deviceId };

  const worktree = await db(env)
    .select({ id: schema.worktrees.id, slug: schema.worktrees.slug })
    .from(schema.worktrees)
    .where(
      and(
        eq(schema.worktrees.projectId, projectId),
        or(eq(schema.worktrees.id, selector), eq(schema.worktrees.slug, selector)),
      ),
    )
    .get();
  return worktree
    ? { deviceId: project.deviceId, worktreeId: worktree.id, worktreeSlug: worktree.slug }
    : null;
}

function workspaceError(c: Context<ApiEnv>, error: unknown) {
  if (error instanceof ExeoraError) {
    const status =
      error.code === "LOCAL_EXECUTOR_OFFLINE" ||
      error.code === "UNKNOWN_WORKTREE" ||
      error.code === "WORKTREE_UNAVAILABLE"
        ? 409
        : error.code === "FORBIDDEN"
          ? 403
          : 422;
    return c.json({ error: error.code, message: error.message }, status);
  }
  console.error("workspace request failed", error);
  return c.json({ error: "INTERNAL_ERROR", message: "Workspace request failed." }, 500);
}
