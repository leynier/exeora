import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { accountAccess } from "../account-access.js";
import { extensionConsent } from "./extension.js";
import { accountConsentPage, consentPage } from "./pages.js";
import { grantedScopes } from "./scopes.js";
import { authScopeFromResource, resolveAccountTarget, resolveAuthTarget } from "./target.js";

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
  const extension = await extensionConsent(env, authRequest.clientId, { client, userEmail, state });
  if (extension) return extension;
  const scope = authScopeFromResource(authRequest.resource);
  const common = {
    client,
    userEmail,
    state,
    scopes: await grantedScopes(env, authRequest),
    // The one fact about the client the person cannot otherwise check: where
    // the code, and so the token, is delivered. A registered name can say
    // anything; the address is what the browser will actually be sent to.
    redirectUri: authRequest.redirectUri,
  };

  if (scope?.kind === "account") {
    const projects = await resolveAccountTarget(env, userId, authRequest.clientId);
    const known = await accountAccess(env, { userId, clientId: authRequest.clientId });
    // A client seen for the first time is offered everything, which is what
    // most people mean; one that was narrowed before comes back narrowed.
    const allProjects = known?.allProjects ?? !projects.some((project) => project.granted);
    return accountConsentPage({ ...common, projects, allProjects });
  }

  return consentPage({
    ...common,
    target: await resolveAuthTarget(env, authRequest.resource, userId),
  });
}
