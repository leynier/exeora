import { Hono } from "hono";
import "./env.js";

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

export default app satisfies ExportedHandler<Env>;
