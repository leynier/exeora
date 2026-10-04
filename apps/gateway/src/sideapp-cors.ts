import { trustedPanelOrigin } from "./plugin-panel-routes.js";

const AUTH_PATHS = new Map([
  ["/oauth/sideapp-client", ["GET"]],
  ["/oauth/device/code", ["POST"]],
  ["/oauth/device/token", ["POST"]],
  ["/oauth/token", ["POST"]],
]);
const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const ALLOWED_HEADERS = new Set(["authorization", "content-type"]);

function allowedMethods(request: Request): string[] | undefined {
  const path = new URL(request.url).pathname;
  return path.startsWith("/api/") ? API_METHODS : AUTH_PATHS.get(path);
}

/** Preflights have no bearer; the actual request must still pass the normal OAuth/API gates. */
export function sideappPreflight(request: Request): Response | undefined {
  if (request.method !== "OPTIONS" || !allowedMethods(request)) return undefined;
  const origin = trustedPanelOrigin(request.headers.get("Origin") ?? undefined);
  if (!origin) return undefined;
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
  );
}

/** No cookies are shared with the isolated Sideapp, and no wildcard account API origin is admitted. */
export function withSideappCors(request: Request, response: Response): Response {
  const methods = allowedMethods(request);
  const origin = trustedPanelOrigin(request.headers.get("Origin") ?? undefined);
  if (
    !methods ||
    !origin ||
    response.status === 101 ||
    (request.method !== "OPTIONS" && !methods.includes(request.method))
  )
    return response;
  const result = new Response(response.body, response);
  result.headers.set("Access-Control-Allow-Origin", origin);
  result.headers.delete("Access-Control-Allow-Credentials");
  const vary = result.headers.get("Vary");
  if (!vary?.split(",").some((value) => value.trim().toLowerCase() === "origin"))
    result.headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  return result;
}
