import "./env.js";

/**
 * Rate limiting, in the two places it can be applied.
 *
 * The unauthenticated endpoints are keyed by IP and have to be limited from
 * outside the OAuth provider, because it answers `/oauth/token` and
 * `/oauth/register` itself and neither handler ever sees them. Everything past
 * a valid token is keyed by user id instead, which is both fairer and harder to
 * spread across addresses.
 *
 * Failing open is deliberate. A limiter that errors should not take the whole
 * gateway down with it: the counters are a defence against hammering, not the
 * thing that decides whether a caller is allowed.
 */

/** How long a caller is asked to wait. Matches `period` in wrangler.jsonc. */
const RETRY_AFTER_SECONDS = 60;

export async function withinLimit(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;

  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    return true;
  }
}

/**
 * The answer to a caller who is going too fast.
 *
 * Plain text rather than JSON: this is returned from the outermost layer, in
 * front of endpoints that answer JSON, HTML and JSON-RPC, and there is no one
 * body shape all three of their clients would understand.
 */
export function tooManyRequests(): Response {
  return new Response("Too many requests. Slow down and try again shortly.", {
    status: 429,
    headers: {
      "Retry-After": String(RETRY_AFTER_SECONDS),
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/**
 * Which unauthenticated requests are worth counting.
 *
 * Only the two the OAuth provider owns and anyone can reach without a token.
 * `/oauth/authorize` is deliberately absent: it is a browser navigation that
 * ends at a sign-in screen, and a person clicking around a consent flow should
 * not be able to lock themselves out of it.
 */
export function isRateLimitedAuthPath(pathname: string): boolean {
  return pathname === "/oauth/token" || pathname === "/oauth/register";
}

/**
 * Which limiter, if any, applies to an authenticated request.
 *
 * Tool calls and account writes are counted; reads are not. A dashboard open
 * in a tab polls devices, clients and activity every fifteen seconds, and
 * putting that on the same budget as registering a machine would mean the
 * limit fires for someone who is doing nothing at all.
 */
export function limiterFor(
  // Only the two bindings it reads, rather than the whole Env. That keeps it
  // callable from a test, where `OAUTH_PROVIDER` does not exist yet: the
  // provider injects it at runtime, on its way into a handler.
  env: Pick<Env, "RL_MCP" | "RL_WRITE">,
  method: string,
  pathname: string,
): RateLimit | undefined {
  // Both MCP endpoints, on one budget keyed by user: the limit is about how
  // much work one account can ask a machine to do, and which URL it came in on
  // does not change that.
  if (pathname.startsWith("/p/") || pathname === "/mcp") return env.RL_MCP;

  if (method === "POST" && (pathname === "/api/devices" || pathname === "/api/projects")) {
    return env.RL_WRITE;
  }

  return undefined;
}

/**
 * The caller's address, or a shared bucket when there is none.
 *
 * `cf-connecting-ip` is set by Cloudflare on every request that reaches a
 * Worker through the edge and cannot be spoofed by the client. It is absent in
 * tests and under `wrangler dev`, where one shared key is the honest answer:
 * pretending each unidentifiable caller is its own bucket would let anyone
 * opt out of the limit by arriving without one.
 */
export function callerAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}
