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
 * Token minting and registration, which anyone can reach without a token.
 * Only POSTs: a GET or OPTIONS at `/oauth/token` or `/oauth/device/token`
 * never reaches the handler, and counting them would let a crawler spend the
 * CLI's IP budget. GET `/oauth/authorize` and GET `/oauth/device` stay
 * uncounted for the same reason as before: they are browser navigations.
 */
export function isRateLimitedAuthRequest(method: string, pathname: string): boolean {
  if (method !== "POST") return false;
  return (
    pathname === "/oauth/token" ||
    pathname === "/oauth/register" ||
    pathname === "/oauth/device" ||
    pathname === "/oauth/device/code" ||
    pathname === "/oauth/device/token"
  );
}

/** Where `gh` in an instance asks for its token. */
const GH_TOKEN = /^\/api\/projects\/[^/]+\/gh-token$/;
/** AI Assist: device logins and key checks under `/api/ai`, generations under a project. */
const AI_WRITE = /^\/api\/(?:ai\/|projects\/[^/]+\/ai\/)/;
const AI_KEY = /^\/api\/ai\/providers\/[^/]+\/key$/;
/** A project's pull request and everything under it: reads are free, changes are counted. */
const PULL_REQUEST = /^\/api\/projects\/[^/]+\/pull-request(\/|$)/;

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

  // Creating a cloud machine is the most expensive write there is: a Sprite
  // per request. It shares the registration budget rather than getting its own.
  // A git credential writes nothing here, but each one can be a token minted
  // at GitHub in the account's name, which is a budget of its own to protect.
  // The token for `gh` is here for whoever asks without being an instance,
  // and for a gateway that has no limiter for instances: see `limitFor`.
  if (
    method === "POST" &&
    (pathname === "/api/devices" ||
      pathname === "/api/projects" ||
      pathname.startsWith("/api/cloud/") ||
      /^\/api\/projects\/[^/]+\/git-credential$/.test(pathname) ||
      GH_TOKEN.test(pathname) ||
      // Each AI request is a device login started or a generation billed to
      // the account's provider; a page that loops would spend that budget.
      AI_WRITE.test(pathname))
  ) {
    return env.RL_WRITE;
  }

  // Storing an API key checks it with the provider first, which is a request
  // there in the account's name like any generation.
  if (method === "PUT" && AI_KEY.test(pathname)) return env.RL_WRITE;

  // Each change to a pull request is a write at GitHub in the account's
  // name; the screen's polling, being GETs, is not.
  if (method !== "GET" && PULL_REQUEST.test(pathname)) return env.RL_WRITE;

  return undefined;
}

/** A limiter, and the key a request is counted under. */
export interface Limit {
  limiter: RateLimit;
  key: string;
}

/**
 * Which limiter applies to an authenticated request, and whose budget it is.
 *
 * Everything is the account's, keyed by its user id, but for one thing: what
 * an instance asks for itself. A machine token carries its owner's user id,
 * and a script that calls `gh` in a loop would otherwise spend the budget
 * its owner registers machines with. So that is counted on a limiter of its
 * own, by instance, and one instance that loops does not starve another.
 */
export function limitFor(
  env: Pick<Env, "RL_MCP" | "RL_WRITE" | "RL_MACHINE">,
  method: string,
  pathname: string,
  caller: { userId: string; deviceId?: string | undefined },
): Limit | undefined {
  // Without the binding the request is still counted, on the account's
  // budget: a gateway deployed from an older configuration has no such limiter.
  const instance = caller.deviceId !== undefined && method === "POST" && GH_TOKEN.test(pathname);
  if (instance && env.RL_MACHINE) {
    return { limiter: env.RL_MACHINE, key: `machine:${caller.deviceId}` };
  }
  const limiter = limiterFor(env, method, pathname);
  return limiter && { limiter, key: caller.userId };
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
