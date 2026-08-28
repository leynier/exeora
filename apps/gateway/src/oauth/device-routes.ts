import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import {
  beginDeviceAuthorization,
  createDeviceGrant,
  formatUserCode,
  lookupDeviceGrantByUserCode,
  pollDeviceGrant,
} from "./device.js";
import { abandonParkedDeviceGrant } from "./device-continue.js";
import { deviceCodePage, errorPage, signInPage } from "./pages.js";
import { claimAuthorization, parkAuthorization } from "./pending.js";
import { configuredProviders } from "./providers/index.js";
import { askForConsent } from "./routes.js";
import { clearSession, getSessionUserId, setDeviceContinuation } from "./session.js";

/**
 * Headless CLI sign-in: mint a code, collect it in a browser, poll until the
 * browser consents. Mounted next to the other OAuth screens so a request
 * without a token can reach it.
 */
export const deviceRoutes = new Hono<{ Bindings: Env }>();

deviceRoutes.get("/oauth/device", async (c) => {
  return c.html(deviceCodePage());
});

deviceRoutes.post("/oauth/device", async (c) => {
  // Browser-only. A cross-site form that already knew the code would skip the
  // warning on GET /oauth/device and start signing the attacker's CLI in.
  const expectedOrigin = new URL(c.env.EXEORA_BASE_URL).origin;
  if (c.req.header("Origin") !== expectedOrigin) {
    return c.html(errorPage("That sign-in could not be completed."), 403);
  }

  const providers = configuredProviders(c.env);
  if (providers.length === 0) {
    return c.html(errorPage("No identity provider is configured on this server."), 500);
  }

  const form = await c.req.formData();
  const userCode = String(form.get("user_code") ?? "");
  const found = await lookupDeviceGrantByUserCode(c.env, userCode);
  if (!found) {
    return c.html(
      deviceCodePage({
        userCode: formatUserCode(userCode),
        problem: "That code is not valid, has expired, or has already been used.",
      }),
      400,
    );
  }

  const state = await parkAuthorization(c.env, {
    authRequest: found.authRequest,
    deviceCodeHash: found.deviceCodeHash,
  });

  if (!(await beginDeviceAuthorization(c.env, found.deviceCodeHash))) {
    await claimAuthorization(c.env, state);
    return c.html(
      deviceCodePage({
        userCode: formatUserCode(userCode),
        problem: "That code is not valid, has expired, or has already been used.",
      }),
      400,
    );
  }

  try {
    await setDeviceContinuation(c, state);
    const userId = await getSessionUserId(c);
    if (userId) {
      const user = await db(c.env)
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .get();

      if (user) {
        return c.html(
          await askForConsent(c.env, {
            authRequest: found.authRequest,
            userId,
            userEmail: user.email,
            state,
          }),
        );
      }

      await clearSession(c);
    }

    return c.html(signInPage(providers, state));
  } catch {
    // The user code is already consumed. Leaving the grant in `completing`
    // would make the CLI poll until TTL with no browser path left to finish it.
    await abandonParkedDeviceGrant(c.env, state);
    return c.html(
      errorPage("That sign-in could not be completed. Start again from the terminal."),
      500,
    );
  }
});

deviceRoutes.post("/oauth/device/code", async (c) => {
  const body = await readBody(c.req.raw);
  const scope = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [];
  const created = await createDeviceGrant(c.env, {
    clientId: String(body.client_id ?? ""),
    codeChallenge: String(body.code_challenge ?? ""),
    codeChallengeMethod: String(body.code_challenge_method ?? ""),
    scope,
  });

  if ("error" in created) {
    return c.json({ error: "invalid_request", error_description: created.error }, 400);
  }

  return c.json({
    device_code: created.deviceCode,
    user_code: created.userCode,
    verification_uri: created.verificationUri,
    expires_in: created.expiresIn,
    interval: created.interval,
  });
});

deviceRoutes.post("/oauth/device/token", async (c) => {
  const body = await readBody(c.req.raw);
  const result = await pollDeviceGrant(c.env, String(body.device_code ?? ""));
  if ("error" in result) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    authorization_code: result.ok.authorizationCode,
    redirect_uri: result.ok.redirectUri,
    iss: result.ok.issuer,
  });
});

async function readBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const value = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, typeof entry === "string" ? entry : ""]),
    );
  }

  const form = await request.formData();
  const body: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") body[key] = value;
  }
  return body;
}
