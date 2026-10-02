import { withSecurityHeaders } from "./assets.js";

const OAUTH_PAGE_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Apply response protections after OAuth has handled tokens and cookies. */
export function gatewayResponse(request: Request, response: Response): Response {
  // Keep the socket and its upgrade response together, without a Response copy.
  if (response.status === 101) return response;
  const url = new URL(request.url);
  const sensitive =
    url.pathname.startsWith("/oauth/") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/p/") ||
    url.pathname === "/mcp" ||
    url.pathname.startsWith("/internal/");
  const oauthPage =
    url.pathname.startsWith("/oauth/") &&
    response.headers.get("Content-Type")?.includes("text/html");
  const result = withSecurityHeaders(response, {
    ...(sensitive ? { cacheControl: "no-store" } : {}),
    ...(oauthPage ? { contentSecurityPolicy: OAUTH_PAGE_POLICY } : {}),
  });
  if (url.protocol === "https:") {
    result.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  if (sensitive) result.headers.set("Referrer-Policy", "no-referrer");
  if (oauthPage) result.headers.set("X-Frame-Options", "DENY");
  return result;
}
