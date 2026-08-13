/**
 * Browser-side OAuth for the dashboard.
 *
 * The dashboard is a public client, exactly like the CLI: it runs in a browser
 * and cannot hold a secret, so it authenticates with PKCE. It needs a real
 * access token rather than riding the session cookie because /api/* is an
 * OAuth-protected resource: the same door every MCP client comes through.
 *
 * The token lives in `sessionStorage`, not `localStorage`: it is scoped to the
 * tab and gone when the tab closes, which bounds what a persistent XSS could
 * exfiltrate later.
 */

const TOKEN_KEY = "exeora.access_token";
const EXPIRY_KEY = "exeora.expires_at";
const VERIFIER_KEY = "exeora.pkce_verifier";
const STATE_KEY = "exeora.oauth_state";
const RETURN_KEY = "exeora.return_to";

interface ClientInfo {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes: string[];
}

let cachedClient: ClientInfo | null = null;

async function client(): Promise<ClientInfo> {
  if (!cachedClient) {
    const response = await fetch("/oauth/dashboard-client");
    if (!response.ok) throw new Error("Could not reach the Exeora gateway.");
    cachedClient = (await response.json()) as ClientInfo;
  }
  return cachedClient;
}

export function storedToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(sessionStorage.getItem(EXPIRY_KEY) ?? 0);
  // A minute of slack so a request never races the clock.
  if (!token || expiresAt - 60_000 < Date.now()) return null;
  return token;
}

export function signOut(): void {
  for (const key of [TOKEN_KEY, EXPIRY_KEY, VERIFIER_KEY, STATE_KEY, RETURN_KEY]) {
    sessionStorage.removeItem(key);
  }
  // Revokes the opaque browser session as well as dropping this tab's access
  // token, so signing out is a server-side action rather than a visual reset.
  window.location.href = "/oauth/logout";
}

/**
 * Sends the browser to the authorization endpoint. Does not return.
 *
 * `returnTo` is explicit because the sign-in screen is itself a route: reading
 * the current location here would send the user back to /signin after a
 * successful sign-in, which is a loop.
 */
export async function beginSignIn(returnTo?: string): Promise<void> {
  const info = await client();
  const verifier = randomString(64);
  const state = randomString(24);

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(RETURN_KEY, returnTo ?? window.location.pathname + window.location.search);

  const url = new URL(info.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", info.clientId);
  url.searchParams.set("redirect_uri", info.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", info.scopes.join(" "));

  window.location.href = url.toString();
}

/** Handles /dashboard/callback. Returns where the user was headed. */
export async function completeSignIn(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error) throw new Error(`Authorization was declined (${error}).`);

  const code = params.get("code");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);

  // Checked before the code is used: a callback carrying someone else's state
  // did not come from this browser's sign-in attempt.
  if (!code || !verifier || params.get("state") !== expectedState) {
    throw new Error("This sign-in response did not match the request. Try again.");
  }

  const info = await client();
  const response = await fetch(info.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: info.clientId,
      code,
      redirect_uri: info.redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) throw new Error(`Token exchange failed (${response.status}).`);

  const tokens = (await response.json()) as { access_token: string; expires_in: number };
  sessionStorage.setItem(TOKEN_KEY, tokens.access_token);
  sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + tokens.expires_in * 1000));
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  const returnTo = sessionStorage.getItem(RETURN_KEY) ?? "/dashboard/";
  sessionStorage.removeItem(RETURN_KEY);
  return returnTo;
}

function randomString(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
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
