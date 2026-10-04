import { firstPartyOrigin } from "./oauth/clients.js";
import { trustedPanelOrigin } from "./plugin-panel-routes.js";

const AUTH_PATHS = new Map([
  ["/oauth/sideapp-client", ["GET"]],
  ["/oauth/device/code", ["POST"]],
  ["/oauth/device/token", ["POST"]],
  ["/oauth/token", ["POST"]],
]);
const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const ALLOWED_HEADERS = new Set(["authorization", "content-type"]);
type UiOrigins = Pick<Env, "EXEORA_BASE_URL" | "EXEORA_EXTENSION_IDS">;

function allowedOrigin(request: Request, env?: UiOrigins): string | undefined {
  const origin = request.headers.get("Origin") ?? undefined;
  return (
    trustedPanelOrigin(origin) ??
    (new URL(request.url).pathname.startsWith("/api/") && env?.EXEORA_BASE_URL
      ? (firstPartyOrigin(env, origin) ?? undefined)
      : undefined)
  );
}

function allowedMethods(request: Request): string[] | undefined {
  const path = new URL(request.url).pathname;
  return path.startsWith("/api/") ? API_METHODS : AUTH_PATHS.get(path);
}

/** Preflights have no bearer; the actual request must still pass the normal OAuth/API gates. */
export function sideappPreflight(request: Request, env?: UiOrigins): Response | undefined {
  if (request.method !== "OPTIONS" || !allowedMethods(request)) return undefined;
  const origin = allowedOrigin(request, env);
  if (!origin)
    return new URL(request.url).pathname.startsWith("/api/")
      ? new Response(null, { status: 403, headers: { Vary: "Origin" } })
      : undefined;
  const method = request.headers.get("Access-Control-Request-Method") ?? "";
  const headers = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (
    !allowedMethods(request)?.includes(method) ||
    headers.some((name) => !ALLOWED_HEADERS.has(name))
  )
    return new Response(null, { status: 403 });
  return withSideappCors(
    request,
    new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": method,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    }),
    env,
  );
}

/** No cookies are shared with the isolated Sideapp, and no wildcard account API origin is admitted. */
export function withSideappCors(request: Request, response: Response, env?: UiOrigins): Response {
  const methods = allowedMethods(request);
  const origin = allowedOrigin(request, env);
  const accountApi = new URL(request.url).pathname.startsWith("/api/");
  if (!methods || response.status === 101 || (!accountApi && !origin)) return response;
  const result = new Response(response.body, response);
  // The OAuth provider reflects any Origin on its protected routes, even
  // preflights and 401s. The account API has a narrower UI boundary. Clear
  // provider CORS before granting it; leave MCP and shared OAuth CORS alone.
  for (const header of [...result.headers.keys()]) {
    if (header.toLowerCase().startsWith("access-control-")) result.headers.delete(header);
  }
  if (origin && (request.method === "OPTIONS" || methods.includes(request.method))) {
    result.headers.set("Access-Control-Allow-Origin", origin);
    result.headers.set("Access-Control-Allow-Methods", methods.join(", "));
    result.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }
  const vary = result.headers.get("Vary");
  if (!vary?.split(",").some((value) => value.trim().toLowerCase() === "origin"))
    result.headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  return result;
}
