import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AccountChoice, accountChoice } from "../account-access.js";
import { db, schema } from "../db/client.js";
import { consentResponse } from "../gateway-response.js";
import { callbackUri, complete, describe } from "./completion.js";
import { askForConsent } from "./consent.js";
import { captureDeviceAuthorization, denyDeviceAuthorization } from "./device.js";
import {
  abandonParkedDeviceGrant,
  deviceCallbackSession,
  refuseUnboundDeviceGrant,
} from "./device-continue.js";
import { refusedExtension, skipsConsent } from "./extension.js";
import { accountConsentPage, deviceDonePage, errorPage, signInPage } from "./pages.js";
import { claimAuthorization, parkAuthorization, peekAuthorization } from "./pending.js";
import { configuredProviders, getProvider } from "./providers/index.js";
import { grantedScopes } from "./scopes.js";
import {
  clearSession,
  clearSigninContinuation,
  getSessionUserId,
  hasSigninContinuation,
  setSession,
  setSigninContinuation,
} from "./session.js";
import { authScopeFromResource, refusedResource, resolveAccountTarget } from "./target.js";
import { resolveUser } from "./users.js";

/**
 * The user-facing half of the authorization server. `OAuthProvider` implements
 * /token, /register and the metadata documents itself; what it delegates here
 * is deciding *who* the user is and whether they consent.
 *
 * The flow parks the authorization request in D1 under an unguessable state,
 * bounces the user through the upstream provider, and only consumes that entry
 * when they approve, which also makes the state the CSRF token for the form.
 */
export const oauthRoutes = new Hono<{ Bindings: Env }>();

type AuthRequest = Awaited<ReturnType<Env["OAUTH_PROVIDER"]["parseAuthRequest"]>>;

oauthRoutes.get("/oauth/authorize", async (c) => {
  let authRequest: AuthRequest;
  try {
    authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (error) {
    return c.html(errorPage(describe(error)), 400);
  }

  const scopes = await grantedScopes(c.env, authRequest);
  if (scopes.length === 0) {
    return c.html(errorPage("This application did not request a scope it is allowed to use."), 400);
  }
  const refused =
    refusedResource(scopes, authRequest.resource) ?? (await refusedExtension(c.env, authRequest));
  if (refused) return c.html(errorPage(refused), 400);

  const providers = configuredProviders(c.env);
  if (providers.length === 0) {
    return c.html(errorPage("No identity provider is configured on this server."), 500);
  }

  const userId = await getSessionUserId(c);

  if (userId) {
    const user = await db(c.env)
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    if (user) {
      if (await skipsConsent(c.env, authRequest, userId)) {
        const { redirectTo } = await complete(c.env, authRequest, userId);
        return c.redirect(redirectTo);
      }

      const state = await parkAuthorization(c.env, { authRequest });
      await setSigninContinuation(c, state);
      return consentResponse(
        c.html(
          await askForConsent(c.env, {
            authRequest,
            userId,
            userEmail: user.email,
            state,
          }),
        ),
        authRequest.redirectUri,
      );
    }

    // A cookie whose user no longer exists: treat it as signed out.
    await clearSession(c);
  }

  // Who is asking, for the sign-in screen: the registered name and where the
  // result would be delivered. Neither is a trust decision; both are shown so
  // a sign-in link that was pasted somewhere else can be read before
  // continuing.
  const askingClient = await c.env.OAUTH_PROVIDER.lookupClient(authRequest.clientId).catch(
    () => null,
  );

  // The state is minted here, in this response, so this is the only browser
  // that can ever hold the cookie that goes with it. Born anywhere else, say
  // from a state read out of a URL, and the cookie would bind nothing:
  // a link carrying someone else's state would mint the match in whichever
  // browser opened it.
  const state = await parkAuthorization(c.env, { authRequest });
  await setSigninContinuation(c, state);

  return c.html(
    signInPage(providers, state, {
      clientName: askingClient?.clientName ?? null,
      redirectUri: authRequest.redirectUri,
    }),
  );
});

oauthRoutes.get("/oauth/login/:provider", async (c) => {
  const provider = getProvider(c.req.param("provider"));
  const state = c.req.query("state");

  if (!state) {
    return c.html(errorPage("That sign-in link is not valid."), 400);
  }
  const blocked = await refuseUnboundDeviceGrant(c, state);
  if (blocked) return blocked;
  if (!provider?.isConfigured(c.env)) {
    if (await abandonParkedDeviceGrant(c.env, state)) {
      return c.html(deviceDonePage("denied"));
    }
    return c.html(errorPage("That sign-in link is not valid."), 400);
  }
  if (!(await peekAuthorization(c.env, state))) {
    return c.html(
      errorPage("This sign-in link has expired. Start again from the application."),
      400,
    );
  }

  // Only the browser the state was born in holds the cookie. A state pasted
  // into a link gets no cookie here and never one later: this route never
  // issues it, so the upstream round trip cannot be started for someone
  // else's parked state.
  if (!(await hasSigninContinuation(c, state))) {
    return c.html(
      errorPage("That sign-in link could not be completed. Start again from the application."),
      400,
    );
  }

  try {
    return c.redirect(
      provider.authorizeUrl(c.env, { redirectUri: callbackUri(c.env, provider.id), state }),
    );
  } catch (error) {
    if (await abandonParkedDeviceGrant(c.env, state)) {
      return c.html(deviceDonePage("denied"));
    }
    return c.html(errorPage(describe(error)), 500);
  }
});

oauthRoutes.get("/oauth/callback/:provider", async (c) => {
  const provider = getProvider(c.req.param("provider"));
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (!state) {
    return c.html(errorPage("That sign-in could not be completed."), 400);
  }

  const blocked = await refuseUnboundDeviceGrant(c, state);
  if (blocked) return blocked;

  if (error || !code) {
    if (await abandonParkedDeviceGrant(c.env, state)) {
      return c.html(deviceDonePage("denied"));
    }
    return c.html(errorPage("That sign-in could not be completed."), 400);
  }

  if (!provider?.isConfigured(c.env)) {
    if (await abandonParkedDeviceGrant(c.env, state)) {
      return c.html(deviceDonePage("denied"));
    }
    return c.html(errorPage("That sign-in could not be completed."), 400);
  }

  const pending = await peekAuthorization(c.env, state);
  if (!pending) {
    return c.html(errorPage("This sign-in has expired. Start again from the application."), 400);
  }

  // A device-code grant carries its own browser binding, checked above. Every
  // other sign-in must arrive in the browser whose /oauth/authorize response
  // created the state: the cookie was minted there and nowhere since, so a
  // copied callback URL cannot install whichever upstream account supplied
  // its code as this browser's session.
  if (!pending.deviceCodeHash && !(await hasSigninContinuation(c, state))) {
    return c.html(errorPage("That sign-in could not be completed. Start again."), 400);
  }

  // Refresh cannot re-exchange a spent upstream code; reuse the first session.
  try {
    const session = await deviceCallbackSession(c, pending.deviceCodeHash);
    if (session) {
      return consentResponse(
        c.html(
          await askForConsent(c.env, {
            authRequest: pending.authRequest,
            userId: session.userId,
            userEmail: session.userEmail,
            state,
          }),
        ),
        pending.authRequest.redirectUri,
      );
    }
  } catch (error) {
    if (await abandonParkedDeviceGrant(c.env, state)) {
      return c.html(deviceDonePage("denied"));
    }
    return c.html(errorPage(describe(error)), 502);
  }

  try {
    const accessToken = await provider.exchangeCode(c.env, {
      code,
      redirectUri: callbackUri(c.env, provider.id),
    });
    const identity = await provider.fetchIdentity(accessToken);
    const user = await resolveUser(db(c.env), provider.id, identity, c.env.ADMIN_EMAILS);
    await setSession(c, user.id);

    if (await skipsConsent(c.env, pending.authRequest, user.id)) {
      // Claimed rather than left parked, so the entry cannot be replayed.
      const claimed = await claimAuthorization(c.env, state);
      if (!claimed) return c.html(errorPage("This sign-in has expired. Start again."), 400);

      const { redirectTo } = await complete(c.env, claimed.authRequest, user.id);
      return c.redirect(redirectTo);
    }

    return consentResponse(
      c.html(
        await askForConsent(c.env, {
          authRequest: pending.authRequest,
          userId: user.id,
          userEmail: user.email,
          state,
        }),
      ),
      pending.authRequest.redirectUri,
    );
  } catch (error) {
    if (await abandonParkedDeviceGrant(c.env, state)) {
      return c.html(deviceDonePage("denied"));
    }
    return c.html(errorPage(describe(error)), 502);
  }
});

oauthRoutes.post("/oauth/approve", async (c) => {
  const form = await c.req.formData();
  const state = String(form.get("state") ?? "");
  const approved = form.get("decision") === "approve";

  const blocked = await refuseUnboundDeviceGrant(c, state);
  if (blocked) return blocked;

  const userId = await getSessionUserId(c);
  if (!userId) {
    if (await abandonParkedDeviceGrant(c.env, state)) {
      return c.html(deviceDonePage("denied"));
    }
    return c.html(errorPage("Your session expired. Start again."), 400);
  }

  // Peeked rather than claimed, because the account screen can come back
  // unanswered and has to be shown again under the same state. The claim below
  // is still the only place an entry is consumed, so a resubmitted form cannot
  // mint a second authorization code.
  //
  // The final claim is one atomic D1 DELETE ... RETURNING, so concurrent
  // submissions cannot both mint a code. The peek keeps the state available
  // only for the account screen's validation round trip.
  const pending = await peekAuthorization(c.env, state);
  if (!pending) return c.html(errorPage("This request has expired. Start again."), 400);

  if (!pending.deviceCodeHash && !(await hasSigninContinuation(c, state))) {
    return c.html(errorPage("This request could not be completed. Start again."), 400);
  }

  const { authRequest } = pending;

  if (!approved) {
    // Consumed on the way out too: a denial that stayed parked could be
    // replayed into an approval. The claim is the single winner against a
    // concurrent approve; a denial that lost must not flip the device grant.
    const claimed = await claimAuthorization(c.env, state);
    if (!claimed) return c.html(errorPage("This request has already been completed."), 400);
    await clearSigninContinuation(c, state);

    if (claimed.deviceCodeHash) {
      await denyDeviceAuthorization(c.env, claimed.deviceCodeHash);
      return c.html(deviceDonePage("denied"));
    }

    const url = new URL(claimed.authRequest.redirectUri);
    url.searchParams.set("error", "access_denied");
    if (claimed.authRequest.state) url.searchParams.set("state", claimed.authRequest.state);
    return c.redirect(url.toString());
  }

  const scope = authScopeFromResource(authRequest.resource);

  // Which projects the account endpoint may reach, narrowed to this user's own
  // before anything is written. The form is attacker-controlled, so an id that
  // is not theirs is dropped rather than refused: refusing would say whether it
  // exists.
  let account: AccountChoice | undefined;
  if (scope?.kind === "account") {
    account = await accountChoice(c.env, userId, form);

    // Nothing ticked: the screen comes back under the same state, so the entry
    // stays parked and everything this branch needs is read only now.
    if (!account.allProjects && account.projectIds.length === 0) {
      const user = await db(c.env)
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();
      if (!user) return c.html(errorPage("Your account could not be found."), 400);

      return consentResponse(
        c.html(
          accountConsentPage({
            client: await c.env.OAUTH_PROVIDER.lookupClient(authRequest.clientId),
            userEmail: user.email,
            state,
            scopes: await grantedScopes(c.env, authRequest),
            redirectUri: authRequest.redirectUri,
            projects: await resolveAccountTarget(c.env, userId, authRequest.clientId),
            allProjects: false,
            problem:
              "Choose at least one project, or cancel. A connection that reaches nothing would " +
              "look broken rather than safe.",
          }),
          400,
        ),
        authRequest.redirectUri,
      );
    }
  }

  const claimed = await claimAuthorization(c.env, state);
  if (!claimed) return c.html(errorPage("This request has expired. Start again."), 400);
  await clearSigninContinuation(c, state);

  try {
    // After the claim: an account that has gone missing is terminal either way,
    // and checking it first would put a read inside the window above for a case
    // that cannot happen to a session that just resolved.
    const user = await db(c.env)
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    if (!user) {
      if (claimed.deviceCodeHash) {
        await denyDeviceAuthorization(c.env, claimed.deviceCodeHash);
      }
      return c.html(errorPage("Your account could not be found."), 400);
    }

    const { redirectTo } = await complete(c.env, claimed.authRequest, userId, account);

    if (claimed.deviceCodeHash) {
      const captured = await captureDeviceAuthorization(c.env, claimed.deviceCodeHash, redirectTo);
      if (!captured) {
        await denyDeviceAuthorization(c.env, claimed.deviceCodeHash);
        return c.html(
          errorPage("This sign-in could not be completed. Start again from the terminal."),
          400,
        );
      }
      return c.html(deviceDonePage("authorized"));
    }

    return c.redirect(redirectTo);
  } catch (error) {
    if (claimed.deviceCodeHash) {
      await denyDeviceAuthorization(c.env, claimed.deviceCodeHash);
    }
    return c.html(errorPage(describe(error)), 502);
  }
});

oauthRoutes.get("/oauth/logout", async (c) => {
  await clearSession(c);
  return c.redirect("/");
});
