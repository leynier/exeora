import { Hono } from "hono";
import "../env.js";
import { github } from "../github/routes.js";
import {
  hasScope,
  insufficientScope,
  isExecutorApiRequest,
  isMachineApiRequest,
} from "../oauth/scopes.js";
import { propsOf } from "../props.js";
import { accountClients } from "./account-clients.js";
import { admin } from "./admin.js";
import { audit } from "./audit.js";
import { clients } from "./clients.js";
import { cloud } from "./cloud.js";
import { cloudScripts } from "./cloud-scripts.js";
import { devices } from "./devices.js";
import { extension } from "./extension.js";
import { locations } from "./locations.js";
import { me } from "./me.js";
import { projects } from "./projects.js";
import type { ApiEnv } from "./router.js";
import { workspace } from "./workspace.js";
import { workspaceCreate } from "./workspace-create.js";
import { workspaces } from "./workspaces.js";

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
  // A machine token names a device, and a device has three things to do over
  // HTTP: open its relay socket, and ask for the git credential and the `gh`
  // token of its own project. It carries the owner's user id only so those
  // can check the device is theirs, never to act as them here.
  const machine = props.deviceId !== undefined;
  if (machine && !isMachineApiRequest(c.req.method, c.req.path)) {
    return insufficientScope(["dashboard:manage"]);
  }
  if (!hasScope(props, "dashboard:manage")) {
    // A machine is held to its own list, which it has just passed, and the
    // person's CLI to the executor's. They differ by the `gh` token, which
    // is an instance's to ask for and nobody else's.
    const executorRoute = machine || isExecutorApiRequest(c.req.method, c.req.path);
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
api.route("/", locations);
api.route("/", workspaces);
api.route("/", workspaceCreate);
api.route("/", workspace);
api.route("/", clients);
api.route("/", accountClients);
api.route("/", extension);
api.route("/", audit);
api.route("/", cloud);
api.route("/", cloudScripts);
api.route("/", github);

// Administration panel. Mounted last so its middleware only sees /api/admin/*
// after the shared auth middleware has already bound the caller.
api.route("/", admin);

export { runNightlyHousekeeping } from "./housekeeping.js";
export { relayName } from "./ops.js";
