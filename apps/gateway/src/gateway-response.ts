import { withSecurityHeaders } from "./assets.js";

function oauthPagePolicy(formActions: readonly string[] = []): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    ["form-action 'self'", ...formActions].join(" "),
    "frame-ancestors 'none'",
  ].join("; ");
}

const OAUTH_PAGE_POLICY = oauthPagePolicy();

/**
 * The CSP source for where a consent form's answer is finally delivered.
 * Browsers apply `form-action` to every redirect after a form submission, so
 * /oauth/approve's redirect to the client must be listed or the browser drops
 * it. Only the origin is listed, or the scheme for an app link such as
 * `cursor://`, and an IPv6 loopback, which a host source cannot spell.
 */
function formActionSource(redirectUri: string): string | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return url.protocol;
  if (url.hostname.startsWith("[")) return url.protocol;
  return url.origin;
}

/** A consent page whose form may end in a redirect to this client's `redirect_uri`. */
export async function consentResponse(
  page: Response | Promise<Response>,
  redirectUri: string,
): Promise<Response> {
  const response = await page;
  const source = formActionSource(redirectUri);
  response.headers.set("Content-Security-Policy", oauthPagePolicy(source ? [source] : []));
  return response;
}

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
    ...(oauthPage
      ? {
          contentSecurityPolicy:
            response.headers.get("Content-Security-Policy") ?? OAUTH_PAGE_POLICY,
        }
      : {}),
  });
  if (url.protocol === "https:") {
    result.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  if (sensitive) result.headers.set("Referrer-Policy", "no-referrer");
  if (oauthPage) result.headers.set("X-Frame-Options", "DENY");
  return result;
}
