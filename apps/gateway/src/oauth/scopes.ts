import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { peekMethod } from "../mcp.js";
import { CLI_SCOPES, DASHBOARD_SCOPES, isCliClient, isDashboardClient } from "./clients.js";

export const MCP_SCOPES = ["tools:read", "tools:execute"] as const;

export type OAuthScope =
  | (typeof CLI_SCOPES)[number]
  | (typeof DASHBOARD_SCOPES)[number]
  | (typeof MCP_SCOPES)[number];

const KNOWN_SCOPES = new Set<string>([...CLI_SCOPES, ...DASHBOARD_SCOPES, ...MCP_SCOPES]);

/**
 * Chooses the maximum permission set a client may receive, then intersects it
 * with what it requested. A third-party client can never mint a dashboard or
 * executor token merely by spelling one of those scopes in its request.
 */
export async function grantedScopes(
  env: Pick<Env, "OAUTH_KV">,
  request: Pick<AuthRequest, "clientId" | "scope">,
) {
  const allowed = await allowedScopes(env, request.clientId);
  const requested = new Set(request.scope.filter((scope) => KNOWN_SCOPES.has(scope)));
  return allowed.filter((scope) => requested.has(scope));
}

async function allowedScopes(env: Pick<Env, "OAUTH_KV">, clientId: string): Promise<OAuthScope[]> {
  if (await isDashboardClient(env, clientId)) return [...DASHBOARD_SCOPES];
  if (await isCliClient(env, clientId)) return [...CLI_SCOPES];
  return [...MCP_SCOPES];
}

export function hasScope(props: { scopes?: readonly string[] }, scope: OAuthScope): boolean {
  return Array.isArray(props.scopes) && props.scopes.includes(scope);
}

export function hasEveryScope(
  props: { scopes?: readonly string[] },
  scopes: readonly OAuthScope[],
): boolean {
  return scopes.every((scope) => hasScope(props, scope));
}

/** The narrow dashboard API surface the native executor actually consumes. */
export function isExecutorApiRequest(method: string, path: string): boolean {
  if (method === "GET") {
    return (
      ["/api/me", "/api/devices", "/api/projects", "/api/tool-calls"].includes(path) ||
      /^\/api\/projects\/[^/]+\/workspaces$/.test(path) ||
      /^\/api\/relay\/[^/]+$/.test(path)
    );
  }
  if (method === "POST") return path === "/api/devices" || path === "/api/projects";
  if (method === "PUT") return /^\/api\/projects\/[^/]+\/workspaces\/[^/]+$/.test(path);
  return (
    method === "DELETE" &&
    (/^\/api\/projects\/[^/]+$/.test(path) ||
      /^\/api\/projects\/[^/]+\/workspaces\/[^/]+$/.test(path))
  );
}

/**
 * Inspects enough of an MCP envelope to choose its effective scope.
 *
 * Unknown or inconsistent POSTs require execute. That conservative fallback
 * matters for large tool arguments, which the bounded method peek deliberately
 * refuses to buffer.
 */
export async function inspectMcpAccess(
  request: Request,
): Promise<{ method: string | undefined; required: "tools:read" | "tools:execute" }> {
  if (request.method !== "POST") return { method: undefined, required: "tools:read" };

  const bodyMethod = await peekMethod(request.clone());
  const modern = request.headers.get("MCP-Protocol-Version") === "2026-07-28";
  const headerMethod = modern ? (request.headers.get("Mcp-Method") ?? undefined) : undefined;
  const mismatched =
    bodyMethod !== undefined && headerMethod !== undefined && bodyMethod !== headerMethod;
  const method = headerMethod ?? bodyMethod;
  const required =
    method === undefined || mismatched || method === "tools/call" ? "tools:execute" : "tools:read";
  return { method, required };
}

/** RFC 6750 response used by protected handlers when the token is valid but too narrow. */
export function insufficientScope(scopes: readonly OAuthScope[]): Response {
  const required = scopes.join(" ");
  return Response.json(
    { error: "insufficient_scope", requiredScopes: scopes },
    {
      status: 403,
      headers: {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${required}"`,
      },
    },
  );
}
