import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import { extensionIds, isDashboardClient, isExtensionClient } from "./clients.js";
import { extensionConsentPage } from "./pages.js";

/**
 * What the Chrome extension's sign-in remembers, and when it is asked again.
 *
 * The dashboard is never asked: it is served from this origin and is the
 * account's own screen. The extension is asked once per account and per
 * extension id, because it is a second place holding a token that can do
 * whatever the dashboard can, and the person should say yes to that knowingly.
 *
 * Per id, not per client: every allowed id is a redirect of the one extension
 * client, and approving the store's extension must not hand a code, without
 * asking, to another build that happens to be allowed too. The answer is kept
 * until the extension is revoked from the dashboard; signing out of the side
 * panel ends that session but is not a change of mind about the extension.
 */

type ExtensionRequest = { clientId: string; redirectUri: string };

const consentPrefix = (userId: string) => `extension_consent:${userId}:`;
const consentKey = (userId: string, extensionId: string) =>
  `${consentPrefix(userId)}${extensionId}`;

/** The extension id a `chromiumapp.org` redirect belongs to, or null for any other. */
export function extensionIdOf(redirectUri: string): string | null {
  return /^https:\/\/([a-p]{32})\.chromiumapp\.org\/$/.exec(redirectUri)?.[1] ?? null;
}

/**
 * Why this request cannot sign in, or null when it can. An extension id that
 * is no longer in `EXEORA_EXTENSION_IDS` is refused here even though its
 * redirect may still be registered: the list, not the registration, is what
 * says which extensions are Exeora's.
 */
export async function refusedExtension(
  env: Pick<Env, "OAUTH_KV" | "EXEORA_EXTENSION_IDS">,
  request: ExtensionRequest,
): Promise<string | null> {
  if (!(await isExtensionClient(env, request.clientId))) return null;
  const id = extensionIdOf(request.redirectUri);
  if (id && extensionIds(env).includes(id)) return null;
  return "This extension is not allowed to sign in to this Exeora server.";
}

/** Whether this sign-in can go straight to a code without the consent screen. */
export async function skipsConsent(
  env: Pick<Env, "OAUTH_KV">,
  request: ExtensionRequest,
  userId: string,
): Promise<boolean> {
  if (await isDashboardClient(env, request.clientId)) return true;
  if (!(await isExtensionClient(env, request.clientId))) return false;
  const id = extensionIdOf(request.redirectUri);
  return id !== null && (await env.OAUTH_KV.get(consentKey(userId, id))) !== null;
}

/**
 * Remembers an approval, when the client is the extension, and returns the
 * extension id it was for. Called where every code is minted, so passing the
 * screen again is also how a revocation is undone. The first approval's time
 * is kept.
 */
export async function rememberExtensionConsent(
  env: Pick<Env, "OAUTH_KV">,
  request: ExtensionRequest,
  userId: string,
): Promise<string | null> {
  if (!(await isExtensionClient(env, request.clientId))) return null;
  const id = extensionIdOf(request.redirectUri);
  if (!id) return null;
  if ((await env.OAUTH_KV.get(consentKey(userId, id))) === null) {
    await env.OAUTH_KV.put(consentKey(userId, id), String(Date.now()));
  }
  return id;
}

/** Every approval this account gave, one per extension id. */
async function consentKeys(env: Pick<Env, "OAUTH_KV">, userId: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_KV.list({
      prefix: consentPrefix(userId),
      ...(cursor ? { cursor } : {}),
    });
    names.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

export async function forgetExtensionConsent(
  env: Pick<Env, "OAUTH_KV">,
  userId: string,
): Promise<void> {
  for (const key of await consentKeys(env, userId)) await env.OAUTH_KV.delete(key);
}

/** When the account first approved any extension id, or null if it has not. */
export async function extensionConsentSince(
  env: Pick<Env, "OAUTH_KV">,
  userId: string,
): Promise<number | null> {
  let earliest: number | null = null;
  for (const key of await consentKeys(env, userId)) {
    const since = Number(await env.OAUTH_KV.get(key));
    if (Number.isFinite(since) && since > 0 && (earliest === null || since < earliest)) {
      earliest = since;
    }
  }
  return earliest;
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
