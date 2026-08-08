import { UpstreamAuthError, type UpstreamIdentity, type UpstreamProvider } from "./types.js";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_URL = "https://api.github.com";

/** GitHub rejects API requests without one. */
const USER_AGENT = "exeora-gateway";

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export const github: UpstreamProvider = {
  id: "github",
  label: "GitHub",

  isConfigured(env) {
    return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  },

  authorizeUrl(env, { redirectUri, state }) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    // read:user for the profile, user:email because a user whose email is
    // private is absent from /user and has to be read from /user/emails.
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode(env, { code, redirectUri }) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      throw new UpstreamAuthError(`GitHub rejected the code exchange (${response.status})`);
    }

    // GitHub answers 200 with an `error` field rather than a 4xx.
    const body = (await response.json()) as { access_token?: string; error_description?: string };
    if (!body.access_token) {
      throw new UpstreamAuthError(body.error_description ?? "GitHub returned no access token");
    }
    return body.access_token;
  },

  async fetchIdentity(accessToken) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    };

    const userResponse = await fetch(`${API_URL}/user`, { headers });
    if (!userResponse.ok) {
      throw new UpstreamAuthError(`Could not read the GitHub profile (${userResponse.status})`);
    }
    const user = (await userResponse.json()) as GitHubUser;

    // Linking providers by email is only safe when the address is verified.
    // `/user` exposes the public profile email but does not carry verification
    // metadata, so always resolve the primary verified address from this endpoint.
    const email = await fetchPrimaryEmail(headers);
    if (!email) {
      throw new UpstreamAuthError("This GitHub account has no verified email address");
    }

    return {
      providerUserId: String(user.id),
      email,
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url,
    } satisfies UpstreamIdentity;
  },
};

async function fetchPrimaryEmail(headers: Record<string, string>): Promise<string | null> {
  const response = await fetch(`${API_URL}/user/emails`, { headers });
  if (!response.ok) return null;

  const emails = (await response.json()) as GitHubEmail[];
  return emails.find((entry) => entry.primary && entry.verified)?.email ?? null;
}
