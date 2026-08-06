import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { consentPage, errorPage, signInPage } from "./pages.js";
import { claimAuthorization, parkAuthorization, peekAuthorization } from "./pending.js";
import { configuredProviders, getProvider, UpstreamAuthError } from "./providers/index.js";
import { clearSession, getSessionUserId, setSession } from "./session.js";
import { resolveUser } from "./users.js";

/**
 * The user-facing half of the authorization server. `OAuthProvider` implements
 * /token, /register and the metadata documents itself; what it delegates here
 * is deciding *who* the user is and whether they consent.
 *
 * The flow parks the authorization request in KV under an unguessable state,
 * bounces the user through the upstream provider, and only consumes that entry
 * when they approve — which also makes the state the CSRF token for the form.
 */
export const oauthRoutes = new Hono<{ Bindings: Env }>();

oauthRoutes.get("/oauth/authorize", async (c) => {
  let authRequest: Awaited<ReturnType<Env["OAUTH_PROVIDER"]["parseAuthRequest"]>>;
  try {
    authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (error) {
    return c.html(errorPage(describe(error)), 400);
  }

  const providers = configuredProviders(c.env);
  if (providers.length === 0) {
    return c.html(errorPage("No identity provider is configured on this server."), 500);
  }

  const state = await parkAuthorization(c.env, { authRequest });
  const userId = await getSessionUserId(c);

  if (!userId) {
    return c.html(signInPage(providers, state));
  }

  const user = await db(c.env)
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  // A cookie whose user no longer exists: treat it as signed out.
  if (!user) {
    clearSession(c);
    return c.html(signInPage(providers, state));
  }

  return c.html(
    consentPage({
      client: await c.env.OAUTH_PROVIDER.lookupClient(authRequest.clientId),
      userEmail: user.email,
      state,
      scopes: authRequest.scope,
    }),
  );
});

oauthRoutes.get("/oauth/login/:provider", async (c) => {
  const provider = getProvider(c.req.param("provider"));
  const state = c.req.query("state");

  if (!provider?.isConfigured(c.env) || !state) {
    return c.html(errorPage("That sign-in link is not valid."), 400);
  }
  if (!(await peekAuthorization(c.env, state))) {
    return c.html(
      errorPage("This sign-in link has expired. Start again from the application."),
      400,
    );
  }

  return c.redirect(
    provider.authorizeUrl(c.env, { redirectUri: callbackUri(c.env, provider.id), state }),
  );
});

oauthRoutes.get("/oauth/callback/:provider", async (c) => {
  const provider = getProvider(c.req.param("provider"));
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!provider?.isConfigured(c.env) || !code || !state) {
    return c.html(errorPage("That sign-in could not be completed."), 400);
  }

  const pending = await peekAuthorization(c.env, state);
  if (!pending) {
    return c.html(errorPage("This sign-in has expired. Start again from the application."), 400);
  }

  try {
    const accessToken = await provider.exchangeCode(c.env, {
      code,
      redirectUri: callbackUri(c.env, provider.id),
    });
    const identity = await provider.fetchIdentity(accessToken);
    const user = await resolveUser(db(c.env), provider.id, identity);
    await setSession(c, user.id);

    return c.html(
      consentPage({
        client: await c.env.OAUTH_PROVIDER.lookupClient(pending.authRequest.clientId),
        userEmail: user.email,
        state,
        scopes: pending.authRequest.scope,
      }),
    );
  } catch (error) {
    return c.html(errorPage(describe(error)), 502);
  }
});

oauthRoutes.post("/oauth/approve", async (c) => {
  const form = await c.req.formData();
  const state = String(form.get("state") ?? "");
  const approved = form.get("decision") === "approve";

  const userId = await getSessionUserId(c);
  if (!userId) return c.html(errorPage("Your session expired. Start again."), 400);

  // Consumed here and nowhere else, so a resubmitted form cannot mint a
  // second authorization code.
  const pending = await claimAuthorization(c.env, state);
  if (!pending) return c.html(errorPage("This request has expired. Start again."), 400);

  if (!approved) {
    const url = new URL(pending.authRequest.redirectUri);
    url.searchParams.set("error", "access_denied");
    if (pending.authRequest.state) url.searchParams.set("state", pending.authRequest.state);
    return c.redirect(url.toString());
  }

  const user = await db(c.env)
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return c.html(errorPage("Your account could not be found."), 400);

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.authRequest,
    userId,
    scope: pending.authRequest.scope,
    metadata: { approvedAt: Date.now() },
    // Everything a tool handler learns about the caller. Deliberately minimal:
    // no upstream token, no email — just who they are, resolved again from D1
    // on every call that needs more.
    props: { userId, clientId: pending.authRequest.clientId },
  });

  return c.redirect(redirectTo);
});

oauthRoutes.get("/oauth/logout", (c) => {
  clearSession(c);
  return c.redirect("/");
});

/**
 * Built from the configured base URL, never from the incoming request.
 *
 * Two reasons. The Host header is attacker-controlled, and a redirect_uri
 * derived from it is a redirect-injection surface. And it has to match the
 * callback registered in the GitHub OAuth app exactly, which is a fixed value
 * per environment — `wrangler dev` rewrites the request host to the configured
 * route, so deriving it from the request breaks local development outright.
 */
function callbackUri(env: Env, providerId: string): string {
  return new URL(`/oauth/callback/${providerId}`, env.EXEORA_BASE_URL).toString();
}

function describe(error: unknown): string {
  if (error instanceof UpstreamAuthError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}
