import { Hono } from "hono";
import "../env.js";
import { getExtensionClientId } from "../oauth/clients.js";
import { extensionConsentSince, forgetExtensionConsent } from "../oauth/extension.js";
import { revokeGrants } from "./ops.js";
import type { ApiEnv } from "./router.js";

/**
 * Exeora for Chrome, as the account sees it: whether it was approved, how many
 * signed-in side panels hold a session, and the way to end all of them.
 *
 * Not in the Clients list, which is about AI clients and the projects they
 * reach. The extension reaches the whole account, the way the dashboard does.
 */

export const extension = new Hono<ApiEnv>();

extension.get("/api/extension", async (c) => {
  const userId = c.get("userId");
  const clientId = await getExtensionClientId(c.env);
  if (!clientId) return c.json({ enabled: false, since: null, sessions: 0 });

  let sessions = 0;
  let cursor: string | undefined;
  do {
    const page = await c.env.OAUTH_PROVIDER.listUserGrants(userId, {
      ...(cursor ? { cursor } : {}),
    });
    sessions += page.items.filter((grant) => grant.clientId === clientId).length;
    cursor = page.cursor;
  } while (cursor);

  return c.json({ enabled: true, since: await extensionConsentSince(c.env, userId), sessions });
});

/**
 * Signs every side panel out and forgets the approval, so the next sign-in
 * asks again. The approval goes first: a grant that failed to revoke is still
 * one nobody can renew without passing the screen.
 */
extension.delete("/api/extension", async (c) => {
  const userId = c.get("userId");
  await forgetExtensionConsent(c.env, userId);
  const clientId = await getExtensionClientId(c.env);
  if (clientId) await revokeGrants(c.env, userId, (grant) => grant.clientId === clientId);
  return c.json({ ok: true });
});
