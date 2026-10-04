/**
 * Signing in to the dashboard ChatGPT shows, with a code.
 *
 * The frame cannot be redirected to the authorization page, so it asks the
 * gateway for a device code, opens the gateway's own sign-in page in the
 * browser, shows the code, and polls until the person approves it there.
 * The poll answers with an authorization code, which is redeemed with PKCE
 * like the dashboard's own sign-in. Every address comes from the gateway the
 * frame was served by; nothing in an answer decides where a secret goes. An
 * answer naming another issuer or redirect is refused rather than redeemed.
 */

export const SIDEAPP_SCOPE = "dashboard:manage";
export const CALLBACK_PATH = "/oauth/device/sideapp-callback";

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  /** When the code stops working, in milliseconds since the epoch. */
  expiresAt: number;
}

export interface DeviceLoginDeps {
  /** The gateway's origin, from the `<base>` it served this page with. */
  gateway: string;
  fetch: typeof fetch;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
}

export interface DeviceTokens {
  accessToken: string;
  expiresIn: number;
}

export class DeviceLoginError extends Error {}

interface Authorized {
  authorization_code: string;
  redirect_uri: string;
  iss: string;
}

export async function deviceLogin(
  deps: DeviceLoginDeps,
  onCode: (code: DeviceCode) => void,
): Promise<DeviceTokens> {
  const { gateway, signal } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? abortableSleep;
  const random = deps.random ?? ((bytes) => crypto.getRandomValues(new Uint8Array(bytes)));
  const post = (path: string, body: Record<string, string>) =>
    deps.fetch(`${gateway}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal,
    });

  const client = await deps.fetch(`${gateway}/oauth/sideapp-client`, { signal });
  if (!client.ok) throw new DeviceLoginError("Could not reach the Exeora gateway.");
  const { client_id: clientId } = (await client.json()) as { client_id?: unknown };
  if (typeof clientId !== "string" || !clientId) {
    throw new DeviceLoginError("The gateway did not name a client to sign in with.");
  }

  const verifier = base64Url(random(48));
  const started = await post("/oauth/device/code", {
    client_id: clientId,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
    scope: SIDEAPP_SCOPE,
  });
  if (!started.ok) throw new DeviceLoginError(await oauthError(started, "start"));
  const device = (await started.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval?: number;
  };
  if (!sameOrigin(device.verification_uri, gateway)) {
    throw new DeviceLoginError("The gateway answered with a sign-in page elsewhere.");
  }
  const expiresAt = now() + device.expires_in * 1000;
  onCode({ userCode: device.user_code, verificationUri: device.verification_uri, expiresAt });

  let interval = Math.max(1, device.interval ?? 5) * 1000;
  let authorized: Authorized | undefined;
  while (authorized === undefined) {
    if (now() + interval > expiresAt) {
      throw new DeviceLoginError("The code expired before it was approved. Start again.");
    }
    await sleep(interval, signal);
    const polled = await post("/oauth/device/token", { device_code: device.device_code });
    if (polled.ok) {
      authorized = (await polled.json()) as Authorized;
      break;
    }
    const error = await errorCode(polled);
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5_000;
      continue;
    }
    throw new DeviceLoginError(
      error === "access_denied"
        ? "Signing in was declined."
        : error === "expired_token"
          ? "The code expired before it was approved. Start again."
          : "Signing in did not complete. Start again.",
    );
  }

  if (trimSlash(authorized.iss) !== gateway) {
    throw new DeviceLoginError("The approval came from another issuer, so it was not used.");
  }
  const redirectUri = `${gateway}${CALLBACK_PATH}`;
  if (authorized.redirect_uri !== redirectUri) {
    throw new DeviceLoginError("The approval named another redirect, so it was not used.");
  }

  const exchanged = await post("/oauth/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    code: authorized.authorization_code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (!exchanged.ok) throw new DeviceLoginError(await oauthError(exchanged, "finish"));
  const tokens = (await exchanged.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof tokens.access_token !== "string" || typeof tokens.expires_in !== "number") {
    throw new DeviceLoginError("The gateway did not answer with a token.");
  }
  return { accessToken: tokens.access_token, expiresIn: tokens.expires_in };
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

async function errorCode(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : null;
}

async function oauthError(response: Response, step: "start" | "finish"): Promise<string> {
  const error = await errorCode(response);
  return `Signing in could not ${step} (${error ?? response.status}).`;
}

function sameOrigin(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === origin && url.protocol === new URL(origin).protocol;
  } catch {
    return false;
  }
}

function trimSlash(value: unknown): string {
  return typeof value === "string" ? value.replace(/\/+$/, "") : "";
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
