/**
 * How the side panel signs in to Exeora and stays signed in.
 *
 * A public OAuth client with PKCE, like the dashboard and the CLI. The code
 * comes back through `chrome.identity.launchWebAuthFlow`, to the
 * `chromiumapp.org` address Chrome reserves for this extension's id, which is
 * why the gateway names that id before it will send a code there.
 *
 * The refresh token is kept in `storage.local`, so a restart of Chrome does
 * not sign anyone out; the access token lives an hour in `storage.session`,
 * which Chrome keeps in memory only. The session ends when the person signs
 * out here, which revokes the refresh token on the gateway, or revokes the
 * extension from the dashboard, which makes the next refresh fail.
 */

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AuthDeps {
  gateway: string;
  fetch: typeof fetch;
  local: StorageArea;
  session: StorageArea;
  identity: {
    getRedirectURL(): string;
    launchWebAuthFlow(options: { url: string; interactive: boolean }): Promise<string | undefined>;
  };
  now: () => number;
}

/** What survives a restart: the refresh token and the client it belongs to. */
interface StoredSession {
  refreshToken: string;
  clientId: string;
}

interface StoredAccess {
  token: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface ClientInfo {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

export const SESSION_KEY = "exeora.session";
const ACCESS_KEY = "exeora.access";

/** The gateway refused the refresh token: revoked, or the account is gone. */
class SessionEnded extends Error {}

export function createAuth(deps: AuthDeps) {
  const tokenEndpoint = `${deps.gateway}/oauth/token`;
  let refreshing: Promise<string | null> | null = null;

  async function stored(): Promise<StoredSession | null> {
    const value = (await deps.local.get(SESSION_KEY))[SESSION_KEY] as StoredSession | undefined;
    return value?.refreshToken && value.clientId ? value : null;
  }

  async function save(clientId: string, tokens: TokenResponse, previous?: string) {
    // The gateway rotates refresh tokens; one that answered without a new one
    // leaves the old one valid.
    const refreshToken = tokens.refresh_token ?? previous;
    if (!refreshToken) throw new Error("The gateway did not issue a refresh token.");
    const access: StoredAccess = {
      token: tokens.access_token,
      expiresAt: deps.now() + tokens.expires_in * 1000,
    };
    await deps.session.set({ [ACCESS_KEY]: access });
    await deps.local.set({ [SESSION_KEY]: { refreshToken, clientId } satisfies StoredSession });
  }

  async function clear() {
    await deps.session.remove(ACCESS_KEY);
    await deps.local.remove(SESSION_KEY);
  }

  async function postToken(body: Record<string, string>): Promise<Response> {
    return deps.fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  }

  async function refresh(): Promise<string | null> {
    const session = await stored();
    if (!session) return null;

    const response = await postToken({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: session.clientId,
    });
    // 400 and 401 are the gateway saying no to this token for good. Anything
    // else (offline, a 5xx) keeps it, so a flaky network does not sign out.
    if (response.status === 400 || response.status === 401) {
      await clear();
      throw new SessionEnded("Your Exeora session ended. Sign in again.");
    }
    if (!response.ok) throw new Error(`Could not reach Exeora (${response.status}).`);

    const tokens = (await response.json()) as TokenResponse;
    await save(session.clientId, tokens, session.refreshToken);
    return tokens.access_token;
  }

  return {
    async isSignedIn(): Promise<boolean> {
      return (await stored()) !== null;
    },

    /**
     * A usable access token, refreshed when it is about to expire. Null once
     * the session has ended. Concurrent callers share one refresh, since the
     * gateway rotates the refresh token on every use.
     */
    async token(options: { force?: boolean } = {}): Promise<string | null> {
      if (!options.force) {
        const access = (await deps.session.get(ACCESS_KEY))[ACCESS_KEY] as StoredAccess | undefined;
        // A minute of slack so a request never races the clock.
        if (access && access.expiresAt - 60_000 > deps.now()) return access.token;
      }
      refreshing ??= refresh()
        .catch((error: unknown) => {
          if (error instanceof SessionEnded) return null;
          throw error;
        })
        .finally(() => {
          refreshing = null;
        });
      return refreshing;
    },

    /** Opens Chrome's sign-in window. Throws with a sentence to show when it fails. */
    async signIn(): Promise<void> {
      const response = await deps.fetch(`${deps.gateway}/oauth/extension-client`);
      if (response.status === 404) {
        throw new Error("This Exeora server does not allow the Chrome extension.");
      }
      if (!response.ok) throw new Error(`Could not reach Exeora (${response.status}).`);
      const client = (await response.json()) as ClientInfo;

      const verifier = randomString(64);
      const state = randomString(24);
      const redirectUri = deps.identity.getRedirectURL();
      const url = new URL(client.authorizationEndpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", await challengeFor(verifier));
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("scope", client.scopes.join(" "));

      let returned: string | undefined;
      try {
        returned = await deps.identity.launchWebAuthFlow({
          url: url.toString(),
          interactive: true,
        });
      } catch {
        // Chrome says the same thing for a closed window and a failed page.
        throw new Error("Sign-in was cancelled.");
      }
      if (!returned) throw new Error("Sign-in was cancelled.");

      const params = new URL(returned).searchParams;
      const error = params.get("error");
      if (error) {
        throw new Error(
          error === "access_denied" ? "Access was not authorized." : `Sign-in failed (${error}).`,
        );
      }
      const code = params.get("code");
      // Checked before the code is used: a response carrying someone else's
      // state did not come from this sign-in.
      if (!code || params.get("state") !== state) {
        throw new Error("This sign-in response did not match the request. Try again.");
      }

      const exchange = await postToken({
        grant_type: "authorization_code",
        client_id: client.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      if (!exchange.ok) throw new Error(`Sign-in failed (${exchange.status}).`);
      await save(client.clientId, (await exchange.json()) as TokenResponse);
    },

    /**
     * Forgets the session here first, then revokes it on the gateway. The
     * order means signing out works offline too; the grant it could not
     * revoke is still revocable from the dashboard.
     */
    async signOut(): Promise<void> {
      const session = await stored();
      await clear();
      if (!session) return;
      await postToken({
        token: session.refreshToken,
        token_type_hint: "refresh_token",
        client_id: session.clientId,
      }).catch(() => undefined);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;

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
