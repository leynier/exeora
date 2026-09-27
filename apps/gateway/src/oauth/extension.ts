import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import { isDashboardClient, isExtensionClient } from "./clients.js";
import { extensionConsentPage } from "./pages.js";

/**
 * What the Chrome extension's sign-in remembers, and when it is asked again.
 *
 * The dashboard is never asked: it is served from this origin and is the
 * account's own screen. The extension is asked once per account, because
 * it is a second place holding a token that can manage everything, and the
 * person should say yes to that knowingly. The answer is kept until they
 * revoke the extension from the dashboard; signing out of the side panel ends
 * that session but is not a change of mind about the extension itself.
 */

const consentKey = (userId: string) => `extension_consent:${userId}`;

/** Whether this sign-in can go straight to a code without the consent screen. */
export async function skipsConsent(
  env: Pick<Env, "OAUTH_KV">,
  clientId: string,
  userId: string,
): Promise<boolean> {
  if (await isDashboardClient(env, clientId)) return true;
  if (!(await isExtensionClient(env, clientId))) return false;
  return (await env.OAUTH_KV.get(consentKey(userId))) !== null;
}

/**
 * Remembers an approval, when the client is the extension, and says whether it
 * was. Called where every code is minted, so passing the screen again is also
 * how a revocation is undone. The first approval's time is kept.
 */
export async function rememberExtensionConsent(
  env: Pick<Env, "OAUTH_KV">,
  clientId: string,
  userId: string,
): Promise<boolean> {
  if (!(await isExtensionClient(env, clientId))) return false;
  if ((await env.OAUTH_KV.get(consentKey(userId))) === null) {
    await env.OAUTH_KV.put(consentKey(userId), String(Date.now()));
  }
  return true;
}

export async function forgetExtensionConsent(
  env: Pick<Env, "OAUTH_KV">,
  userId: string,
): Promise<void> {
  await env.OAUTH_KV.delete(consentKey(userId));
}

/** When the account approved the extension, or null if it has not. */
export async function extensionConsentSince(
  env: Pick<Env, "OAUTH_KV">,
  userId: string,
): Promise<number | null> {
  const stored = await env.OAUTH_KV.get(consentKey(userId));
  const since = Number(stored);
  return stored !== null && Number.isFinite(since) ? since : null;
}

/** The extension's own consent screen, or null when the client is anything else. */
export async function extensionConsent(
  env: Pick<Env, "OAUTH_KV">,
  clientId: string,
  options: { client: ClientInfo | null; userEmail: string; state: string },
) {
  if (!(await isExtensionClient(env, clientId))) return null;
  return extensionConsentPage(options);
}
