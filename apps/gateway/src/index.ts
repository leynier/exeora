import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import "./env.js";
import { createProjectMcpHandler } from "./mcp.js";
import { CLI_SCOPES, getCliClientId } from "./oauth/cli-client.js";
import { oauthRoutes } from "./oauth/routes.js";

export { DeviceRelay } from "./relay-do.js";

/**
 * Gateway Worker: OAuth authorization server, MCP endpoint, relay entry point
 * and dashboard API. The landing page and dashboard live in a separate Worker
 * (`apps/web`) so this one stays free of anything presentational.
 *
 * Routing is by path specificity on the same zone — see `routes` in
 * wrangler.jsonc. Anything not claimed here falls through to `apps/web`.
 */

/** Requests carrying a valid access token. `ctx.props` holds the grant's props. */
const api = new Hono<{ Bindings: Env }>();

api.get("/api/health", (c) => c.json({ ok: true, service: "exeora-gateway" }));

api.all("/p/:projectId/mcp", async (c) => {
  const projectId = c.req.param("projectId");

  // TODO(M5): verify the token's user owns this project, then dispatch to the
  // device relay instead of erroring.
  const handler = createProjectMcpHandler(projectId, async () => {
    throw new Error("LOCAL_EXECUTOR_OFFLINE");
  });

  // `.fetch()` rather than the (request, env, ctx) form: bindings reach the
  // tools through the dispatcher closure, so the handler needs no ExecutionContext.
  return handler.fetch(c.req.raw);
});

/** Everything else: the OAuth screens, plus unauthenticated fall-through. */
const site = new Hono<{ Bindings: Env }>();
site.route("/", oauthRoutes);

/**
 * Tells `exeora login` which client id to use. Unauthenticated by design —
 * it reveals nothing secret, and the CLI must call it before it holds any
 * token. Under /oauth/ rather than /api/ precisely because /api/ is an
 * `apiRoute`, where the provider demands a token before any handler runs.
 */
site.get("/oauth/cli-client", async (c) =>
  c.json({
    clientId: await getCliClientId(c.env),
    authorizationEndpoint: new URL("/oauth/authorize", c.env.EXEORA_BASE_URL).toString(),
    tokenEndpoint: new URL("/oauth/token", c.env.EXEORA_BASE_URL).toString(),
    scopes: CLI_SCOPES,
  }),
);

export default new OAuthProvider({
  apiRoute: ["/p/", "/api/"],
  apiHandler: api,
  defaultHandler: site,

  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",

  // ChatGPT still requires Dynamic Client Registration, while the 2026-07-28
  // spec deprecates it in favour of Client ID Metadata Documents. Both are on
  // so neither class of client is locked out.
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,

  scopesSupported: ["tools:read", "tools:execute", ...CLI_SCOPES],

  // resourceMetadata.resource is deliberately left unset: the provider then
  // derives one resource identifier per path, so a token minted for
  // /p/a/mcp is not accepted at /p/b/mcp. Pinning a single value here would
  // collapse every project into one audience.
  resourceMetadata: {
    resource_name: "Exeora",
    scopes_supported: ["tools:read", "tools:execute"],
  },
});
