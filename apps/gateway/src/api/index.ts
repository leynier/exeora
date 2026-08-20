import { Hono } from "hono";
import "../env.js";
import { hasScope, insufficientScope, isExecutorApiRequest } from "../oauth/scopes.js";
import { propsOf } from "../props.js";
import { accountClients } from "./account-clients.js";
import { admin } from "./admin.js";
import { audit } from "./audit.js";
import { clients } from "./clients.js";
import { devices } from "./devices.js";
import { me } from "./me.js";
import { projects } from "./projects.js";
import type { ApiEnv } from "./router.js";
import { workspace } from "./workspace.js";
import { worktrees } from "./worktrees.js";

/**
 * The dashboard and CLI API. Everything here runs behind `apiRoute`, so the
 * OAuth provider has already validated the bearer token; `ctx.props` carries
 * the grant's props and is the only source of the caller's identity.
 *
 * Every owner query is filtered by that user id. The administration panel is
 * the one exception: it is gated by an email allow-list and can look across
 * accounts, but only through the `/api/admin` routes it mounts.
 *
 * This file composes and does nothing else. The routers below own absolute
 * paths rather than a prefix each, so they are all mounted at `/`: what a route
 * answers is written at the route, not assembled from where its file happens to
 * be attached.
 */

export const api = new Hono<ApiEnv>();

api.use("/api/*", async (c, next) => {
  const props = propsOf(c.executionCtx);
  const userId = props.userId;
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  if (!hasScope(props, "dashboard:manage")) {
    const executorRoute = isExecutorApiRequest(c.req.method, c.req.path);
    if (!executorRoute || !hasScope(props, "executor:connect")) {
      return insufficientScope([executorRoute ? "executor:connect" : "dashboard:manage"]);
    }
  }
  c.set("userId", userId);
  await next();
});

api.get("/api/health", (c) => c.json({ ok: true, service: "exeora-gateway" }));

api.route("/", me);
api.route("/", devices);
api.route("/", projects);
api.route("/", worktrees);
api.route("/", workspace);
api.route("/", clients);
api.route("/", accountClients);
api.route("/", audit);

// Administration panel. Mounted last so its middleware only sees /api/admin/*
// after the shared auth middleware has already bound the caller.
api.route("/", admin);

export { runNightlyHousekeeping } from "./housekeeping.js";
export { relayName } from "./ops.js";
