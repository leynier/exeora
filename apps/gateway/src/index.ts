import { Hono } from "hono";
import "./env.js";
import { createProjectMcpHandler } from "./mcp.js";

export { DeviceRelay } from "./relay-do.js";

/**
 * Gateway Worker: OAuth authorization server, MCP endpoint, relay entry point
 * and dashboard API. The landing page and dashboard live in a separate Worker
 * (`apps/web`) so this one stays free of anything presentational.
 *
 * Routing is by path specificity on the same zone — see `routes` in
 * wrangler.jsonc. Anything not claimed here falls through to `apps/web`.
 */
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, service: "exeora-gateway" }));

app.all("/p/:projectId/mcp", async (c) => {
  const projectId = c.req.param("projectId");

  // TODO(M2): reject unless the OAuth token belongs to a user who owns this
  // project. TODO(M5): dispatch to the device's relay instead of erroring.
  const handler = createProjectMcpHandler(projectId, async () => {
    throw new Error("LOCAL_EXECUTOR_OFFLINE");
  });

  // `.fetch()` rather than the (request, env, ctx) form: bindings reach the
  // tools through the dispatcher closure, so the handler needs no ExecutionContext.
  return handler.fetch(c.req.raw);
});

export default app satisfies ExportedHandler<Env>;
