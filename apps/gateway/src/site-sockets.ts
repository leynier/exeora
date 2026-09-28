import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { relayName } from "./api/ops.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { firstPartyOrigin } from "./oauth/clients.js";

/**
 * The two sockets a dashboard tab opens straight to a machine's relay: a
 * terminal, and the live log of its calls. Neither carries an access token,
 * because a browser cannot put one on a WebSocket; each carries a ticket the
 * API issued to the signed-in owner a moment before, for one project root or
 * workspace and one origin, and spendable once.
 */
export const sockets = new Hono<{ Bindings: Env }>();

type SocketContext = Context<{ Bindings: Env }>;

interface Target {
  relay: DurableObjectStub<import("./relay-do.js").DeviceRelay>;
  projectId: string;
  workspaceId: string | undefined;
  workspaceSlug: string | undefined;
}

sockets.get("/terminal/connect", async (c) => {
  const cols = Number(c.req.query("cols"));
  const rows = Number(c.req.query("rows"));
  const sized =
    Number.isInteger(cols) &&
    cols >= 20 &&
    cols <= 500 &&
    Number.isInteger(rows) &&
    rows >= 5 &&
    rows <= 300;
  const target = await ticketedTarget(c, "terminal", sized);
  if (target instanceof Response) return target;
  const url = relayUrl("terminal", target);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  return target.relay.fetch(new Request(url, { headers: { Upgrade: "websocket" } }));
});

sockets.get("/logs/connect", async (c) => {
  const target = await ticketedTarget(c, "logs");
  if (target instanceof Response) return target;
  const url = relayUrl("logs", target);
  return target.relay.fetch(new Request(url, { headers: { Upgrade: "websocket" } }));
});

function relayUrl(kind: "terminal" | "logs", target: Target): URL {
  const url = new URL(`https://relay/caller/${kind}`);
  url.searchParams.set("id", crypto.randomUUID());
  url.searchParams.set("projectId", target.projectId);
  if (target.workspaceId) url.searchParams.set("workspaceId", target.workspaceId);
  if (target.workspaceSlug) url.searchParams.set("workspaceSlug", target.workspaceSlug);
  return url;
}

/**
 * The machine a socket's ticket was issued for, once the ticket is spent: the
 * project's, the workspace's, or the one holding the root that was asked
 * for. Anything that does not add up is refused, as not found where saying
 * more would say whether a project exists.
 */
async function ticketedTarget(
  c: SocketContext,
  kind: "terminal" | "logs",
  /** Whatever else the request must carry, checked with the rest of its query. */
  valid = true,
): Promise<Target | Response> {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected a WebSocket upgrade.", 426);
  }
  // The dashboard's origin or an allowed extension's. Which of them may use
  // this ticket was decided when it was issued, and is checked with it below.
  const expectedOrigin = firstPartyOrigin(c.env, c.req.header("Origin"));
  if (!expectedOrigin) return c.text("Invalid origin.", 403);
  const projectId = c.req.query("projectId");
  const deviceId = c.req.query("deviceId");
  const workspaceId = c.req.query("workspaceId");
  const workspaceSlug = c.req.query("workspaceSlug");
  const ticket = c.req.query("ticket");
  if (
    !projectId ||
    !deviceId ||
    !ticket ||
    !/^[0-9a-f]{64}$/.test(ticket) ||
    Boolean(workspaceId) !== Boolean(workspaceSlug) ||
    !valid
  ) {
    return c.text(`Invalid ${kind} request.`, 400);
  }
  const project = await db(c.env)
    .select({ userId: schema.projects.userId, deviceId: schema.projects.deviceId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.text("Project not found.", 404);
  // The machine is the workspace's own when it has one, otherwise the
  // project's. The URL has to name exactly that machine.
  let servedBy = project.deviceId;
  if (workspaceId && workspaceSlug) {
    const workspace = await db(c.env)
      .select({ id: schema.workspaces.id, deviceId: schema.workspaces.deviceId })
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.id, workspaceId),
          eq(schema.workspaces.projectId, projectId),
          eq(schema.workspaces.slug, workspaceSlug),
        ),
      )
      .get();
    if (!workspace) return c.text("Workspace not found.", 404);
    servedBy = workspace.deviceId ?? project.deviceId;
  }
  // The root of a location other than the default is served by that
  // location's machine, which is the one case where the machine named is
  // neither the project's nor a workspace's.
  if (
    deviceId !== servedBy &&
    !(workspaceId === undefined && (await holdsRoot(c.env, projectId, deviceId)))
  ) {
    return c.text("Project not found.", 404);
  }
  const device = await db(c.env)
    .select({ id: schema.devices.id })
    .from(schema.devices)
    .where(
      and(
        eq(schema.devices.id, deviceId),
        eq(schema.devices.userId, project.userId),
        isNull(schema.devices.revokedAt),
      ),
    )
    .get();
  if (!device) return c.text("Project not found.", 404);
  const relay = c.env.DEVICE_RELAY.getByName(relayName(project.userId, deviceId));
  const spent = await relay.consumeTerminalTicket(
    ticket,
    projectId,
    workspaceId,
    workspaceSlug,
    expectedOrigin,
    kind,
  );
  if (!spent) {
    return c.text(`${kind === "logs" ? "Logs" : "Terminal"} ticket is invalid or expired.`, 403);
  }
  return { relay, projectId, workspaceId, workspaceSlug };
}

/** Whether a machine is a location of the project that has a copy of its root. */
async function holdsRoot(env: Pick<Env, "DB">, projectId: string, deviceId: string) {
  const row = await db(env)
    .select({ id: schema.projectLocations.id })
    .from(schema.projectLocations)
    .where(
      and(
        eq(schema.projectLocations.projectId, projectId),
        eq(schema.projectLocations.deviceId, deviceId),
        eq(schema.projectLocations.status, "ready"),
      ),
    )
    .get();
  return row !== undefined;
}
