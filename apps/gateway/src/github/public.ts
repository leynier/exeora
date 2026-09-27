import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import "../env.js";
import { getSessionUserId } from "../oauth/session.js";
import { githubConfig } from "./app.js";
import { completeConnection } from "./installations.js";
import { linkByRepository } from "./links.js";
import { outbound } from "./outbound.js";
import { consumeConnectState, verifyConnectState } from "./state.js";
import { handleWebhook, verifySignature } from "./webhook.js";

/**
 * The two addresses GitHub itself calls, neither of which can hold an access
 * token: the browser coming back from an installation, and the webhook.
 *
 * Each carries its own proof instead. The webhook has GitHub's signature over
 * its body. The callback has two things that have to agree: the `state` this
 * gateway signed for the account that left, and the session of the browser
 * that came back. The state alone would not do. It is a link, and a link can
 * be sent to somebody else, whose repositories would then be connected to
 * the account of whoever sent it.
 */

export const GITHUB_CALLBACK_PATH = "/api/github/callback";
export const GITHUB_WEBHOOK_PATH = "/api/github/webhook";

/**
 * Whether a request is one of the two. They live under `/api/`, which the
 * OAuth provider guards as a whole, so the Worker's entry point asks this
 * before the provider is given the request.
 */
export function isGitHubPublicRequest(method: string, pathname: string): boolean {
  return (
    (method === "GET" && pathname === GITHUB_CALLBACK_PATH) ||
    (method === "POST" && pathname === GITHUB_WEBHOOK_PATH)
  );
}

export const githubPublic = new Hono<{ Bindings: Env }>();

githubPublic.get(GITHUB_CALLBACK_PATH, async (c) => {
  if (!githubConfig(c.env)) return c.json({ error: "github_disabled" }, 404);

  const back = (outcome: "connected" | "failed", reason?: string) => {
    const url = new URL("/dashboard/settings", c.env.EXEORA_BASE_URL);
    url.searchParams.set("github", outcome);
    if (reason) url.searchParams.set("reason", reason);
    return c.redirect(url.toString(), 302);
  };

  const state = await verifyConnectState(c.env, c.req.query("state"));
  if (!state) return back("failed", "state_invalid");
  const { userId } = state;
  const account = await db(c.env)
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!account) return back("failed", "state_invalid");

  // The browser has to be signed in to Exeora as the account the state
  // names. Somebody who was sent this link is signed in as themselves, or
  // not at all, and nothing of theirs is connected to anybody.
  if ((await getSessionUserId(c)) !== userId) return back("failed", "session_required");
  // Spent here, once it is known to be in the right hands, and before it is
  // acted on: whatever comes of this attempt, the state is not good again.
  if (!(await consumeConnectState(c.env, state))) return back("failed", "state_used");

  if (c.req.query("error")) return back("failed", "denied");
  const code = c.req.query("code");
  if (!code) {
    // An organisation that approves installations sends its member back with
    // nothing to exchange: the request is with an owner, not refused.
    const requested = c.req.query("setup_action") === "request";
    return back("failed", requested ? "approval_pending" : "code_missing");
  }
  const named = c.req.query("installation_id");
  if (named !== undefined && !/^[1-9]\d{0,15}$/.test(named)) {
    return back("failed", "installation_invalid");
  }

  const fetcher = outbound();
  const connection = await completeConnection(
    c.env,
    userId,
    { code, installationId: named === undefined ? null : Number(named) },
    fetcher,
  );
  if (!connection.ok) return back("failed", connection.reason);

  // Best effort: the connection stands whether or not the projects the
  // account already had could be matched this time.
  await linkByRepository(c.env, userId, fetcher).catch(() => undefined);
  return back("connected");
});

githubPublic.post(GITHUB_WEBHOOK_PATH, async (c) => {
  const config = githubConfig(c.env);
  if (!config) return c.json({ error: "github_disabled" }, 404);

  const signature = c.req.header("X-Hub-Signature-256");
  // Refused before the body is read: a caller with no signature is not GitHub.
  if (!signature) return c.json({ error: "invalid_signature" }, 401);
  const body = await c.req.arrayBuffer();
  if (!(await verifySignature(config.webhookSecret, body, signature))) {
    return c.json({ error: "invalid_signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return c.json({ error: "invalid_payload" }, 400);
  }
  const handled = await handleWebhook(
    c.env,
    c.req.header("X-GitHub-Event") ?? "",
    payload,
    outbound(),
  );
  return handled ? c.json({ ok: true }) : c.body(null, 204);
});
