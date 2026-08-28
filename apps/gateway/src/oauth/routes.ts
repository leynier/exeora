import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { rememberAuthorization, revokeAccountProjectsExcept } from "../clients.js";
import { db, schema } from "../db/client.js";
import { isDashboardClient } from "./clients.js";
import { captureDeviceAuthorization, denyDeviceAuthorization } from "./device.js";
import {
  abandonParkedDeviceGrant,
  deviceCallbackSession,
  refuseUnboundDeviceGrant,
} from "./device-continue.js";
import { accountConsentPage, consentPage, deviceDonePage, errorPage, signInPage } from "./pages.js";
import { claimAuthorization, parkAuthorization, peekAuthorization } from "./pending.js";
import { configuredProviders, getProvider, UpstreamAuthError } from "./providers/index.js";
import { grantedScopes } from "./scopes.js";
import { clearSession, getSessionUserId, setSession } from "./session.js";
import {
  authScopeFromResource,
  ownedProjectIds,
  resolveAccountTarget,
  resolveAuthTarget,
} from "./target.js";
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

  if ((await grantedScopes(c.env, authRequest)).length === 0) {
    return c.html(errorPage("This application did not request a scope it is allowed to use."), 400);
  }

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
      if (await isDashboardClient(c.env, authRequest.clientId)) {
        const { redirectTo } = await complete(c.env, authRequest, userId);
        return c.redirect(redirectTo);
      }

      return c.html(
        await askForConsent(c.env, {
          authRequest,
          userId,
          userEmail: user.email,
          state: await parkAuthorization(c.env, { authRequest }),
        }),
      );
    }

    // A cookie whose user no longer exists: treat it as signed out.
    await clearSession(c);
  }

  return c.html(signInPage(providers, await parkAuthorization(c.env, { authRequest })));
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

  // Refresh cannot re-exchange a spent upstream code; reuse the first session.
  try {
    const session = await deviceCallbackSession(c, pending.deviceCodeHash);
    if (session) {
      return c.html(
        await askForConsent(c.env, {
          authRequest: pending.authRequest,
          userId: session.userId,
          userEmail: session.userEmail,
          state,
        }),
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

    if (await isDashboardClient(c.env, pending.authRequest.clientId)) {
      // Claimed rather than left parked, so the entry cannot be replayed.
      const claimed = await claimAuthorization(c.env, state);
      if (!claimed) return c.html(errorPage("This sign-in has expired. Start again."), 400);

      const { redirectTo } = await complete(c.env, claimed.authRequest, user.id);
      return c.redirect(redirectTo);
    }

    return c.html(
      await askForConsent(c.env, {
        authRequest: pending.authRequest,
        userId: user.id,
        userEmail: user.email,
        state,
      }),
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

  const { authRequest } = pending;

  if (!approved) {
    // Consumed on the way out too: a denial that stayed parked could be
    // replayed into an approval. The claim is the single winner against a
    // concurrent approve; a denial that lost must not flip the device grant.
    const claimed = await claimAuthorization(c.env, state);
    if (!claimed) return c.html(errorPage("This request has already been completed."), 400);

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
  let projectIds: string[] | undefined;
  if (scope?.kind === "account") {
    projectIds = await ownedProjectIds(
      c.env,
      userId,
      form.getAll("project").map((value) => String(value)),
    );

    // Nothing ticked: the screen comes back under the same state, so the entry
    // stays parked and everything this branch needs is read only now.
    if (projectIds.length === 0) {
      const user = await db(c.env)
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();
      if (!user) return c.html(errorPage("Your account could not be found."), 400);

      return c.html(
        accountConsentPage({
          client: await c.env.OAUTH_PROVIDER.lookupClient(authRequest.clientId),
          userEmail: user.email,
          state,
          scopes: await grantedScopes(c.env, authRequest),
          projects: await resolveAccountTarget(c.env, userId, authRequest.clientId),
          problem:
            "Choose at least one project, or cancel. A connection that reaches nothing would " +
            "look broken rather than safe.",
        }),
        400,
      );
    }
  }

  const claimed = await claimAuthorization(c.env, state);
  if (!claimed) return c.html(errorPage("This request has expired. Start again."), 400);

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

    const { redirectTo } = await complete(c.env, claimed.authRequest, userId, projectIds);

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

/**
 * Mints the authorization code, from the one place that decides what a token
 * carries.
 *
 * Reached from three directions: an explicit approval, a first-party client
 * with a session, and a first-party client that has just signed in. Splitting
 * the props across those would be how one of them quietly ends up different.
 *
 * It is also where a client becomes visible to the user, because this is the
 * only moment the gateway holds both the project the token is for and the
 * client's registered name at once.
 */
async function complete(
  env: Env,
  authRequest: AuthRequest,
  userId: string,
  /** The projects ticked on the account screen. Absent for every other flow. */
  accountProjectIds?: string[],
) {
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId).catch(() => null);
  const scope = authScopeFromResource(authRequest.resource);
  const scopes = await grantedScopes(env, authRequest);
  const identity = { clientName: client?.clientName, clientUri: client?.clientUri };

  const projectId =
    scope?.kind === "project" ? await ownedProjectId(env, scope.projectId, userId) : null;
  const projectIds = scope?.kind === "account" ? (accountProjectIds ?? []) : null;

  if (projectId) {
    await rememberAuthorization(env, {
      userId,
      projectId,
      clientId: authRequest.clientId,
      endpoint: "project",
      ...identity,
    });
  }

  if (projectIds) {
    for (const id of projectIds) {
      await rememberAuthorization(env, {
        userId,
        projectId: id,
        clientId: authRequest.clientId,
        endpoint: "account",
        ...identity,
      });
    }

    // What the screen did not tick is what it took away. Done after the
    // additions so a re-approval that keeps everything never passes through a
    // moment with nothing granted.
    await revokeAccountProjectsExcept(env, {
      userId,
      clientId: authRequest.clientId,
      keep: projectIds,
    });
  }

  return env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId,
    scope: scopes,
    // `projectId` is here because a grant summary does not carry the resource
    // it was issued for, and revoking one client's access to one project means
    // finding exactly the grants that named it. `projectIds` is the same fact
    // for the account endpoint, where one grant covers several; which of the
    // two is present is also how a grant says which endpoint it is for.
    metadata: {
      approvedAt: Date.now(),
      projectId,
      ...(projectIds ? { projectIds } : {}),
      clientName: client?.clientName ?? null,
    },
    // Everything a tool handler learns about the caller. Deliberately minimal:
    // no upstream token, no email: just who they are, resolved again from D1
    // on every call that needs more. The name rides along only so the audit
    // log stays readable without a KV read per tool call.
    props: {
      userId,
      clientId: authRequest.clientId,
      clientName: client?.clientName,
      scopes,
    },
  });
}

/**
 * The screen that asks, chosen by what the client said it wants.
 *
 * Both branches resolve their own target, and both fall back to the plain
 * screen when they cannot: a resource naming a project that is not this user's
 * must not be labelled with anything, since naming it would leak that it
 * exists.
 */
export async function askForConsent(
  env: Env,
  options: { authRequest: AuthRequest; userId: string; userEmail: string; state: string },
) {
  const { authRequest, userId, userEmail, state } = options;
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const scope = authScopeFromResource(authRequest.resource);
  const common = {
    client,
    userEmail,
    state,
    scopes: await grantedScopes(env, authRequest),
  };

  if (scope?.kind === "account") {
    return accountConsentPage({
      ...common,
      projects: await resolveAccountTarget(env, userId, authRequest.clientId),
    });
  }

  return consentPage({
    ...common,
    target: await resolveAuthTarget(env, authRequest.resource, userId),
  });
}

/**
 * The project this authorization is for, if it is one of the user's own.
 *
 * The CLI and the dashboard ask for no resource at all and never reach here,
 * which is why neither of them ever shows up as a client of a project.
 */
async function ownedProjectId(
  env: Pick<Env, "DB">,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const project = await db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();

  return project?.id ?? null;
}

/**
 * Built from the configured base URL, never from the incoming request.
 *
 * Two reasons. The Host header is attacker-controlled, and a redirect_uri
 * derived from it is a redirect-injection surface. And it has to match the
 * callback registered with the upstream provider exactly, which is a fixed value
 * per environment, and `wrangler dev` rewrites the request host to the configured
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
