import { UpstreamAuthError, type UpstreamIdentity, type UpstreamProvider } from "./types.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

interface GoogleUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export const google: UpstreamProvider = {
  id: "google",
  label: "Google",

  isConfigured(env) {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  },

  authorizeUrl(env, { redirectUri, state }) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode(env, { code, redirectUri }) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      throw new UpstreamAuthError(`Google rejected the code exchange (${response.status})`);
    }

    const body = (await response.json()) as { access_token?: string; error_description?: string };
    if (!body.access_token) {
      throw new UpstreamAuthError(body.error_description ?? "Google returned no access token");
    }
    return body.access_token;
  },

  async fetchIdentity(accessToken) {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new UpstreamAuthError(`Could not read the Google profile (${response.status})`);
    }

    const user = (await response.json()) as GoogleUser;
    if (!user.sub || !user.email || user.email_verified !== true) {
      throw new UpstreamAuthError("This Google account has no verified email address");
    }

    return {
      providerUserId: user.sub,
      email: user.email,
      name: user.name ?? user.email,
      avatarUrl: user.picture ?? null,
    } satisfies UpstreamIdentity;
  },
};
