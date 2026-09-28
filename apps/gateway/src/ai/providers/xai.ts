import { curatedModels, mergeModels } from "../catalog.js";
import {
  chatCompletionText,
  expectOk,
  formBody,
  GENERATE_TIMEOUT_MS,
  listedModels,
  outputText,
  providerFetch,
  readJson,
  responsesInput,
} from "./http.js";
import { decodeJwtPayload, stringClaim } from "./jwt.js";
import {
  type AiEnv,
  AiError,
  type AiProvider,
  type Credential,
  type DevicePoll,
  type GrantedTokens,
} from "./types.js";

/**
 * Grok, through the xAI API.
 *
 * An API key speaks to the documented API. The OAuth path is a standard
 * device grant (RFC 8628) against xAI's OpenID provider, found by discovery,
 * with a client id the gateway is given in `XAI_OAUTH_CLIENT_ID`: without
 * one, only the key is offered. That flow is UNOFFICIAL, observed in other
 * tools rather than promised by xAI, and may stop working without notice.
 */

// Unofficial: xAI's OpenID provider, whose discovery document names the endpoints.
const OIDC_ISSUER = "https://auth.x.ai";
const OIDC_DISCOVERY_URL = `${OIDC_ISSUER}/.well-known/openid-configuration`;
// Unofficial: what the device grant asks for. Discovery lists `api:access` among
// the scopes; a refresh token needs `offline_access`. Neither is documented.
const OAUTH_SCOPE = "openid profile email offline_access api:access";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
// Documented: the xAI API.
const API_RESPONSES_URL = "https://api.x.ai/v1/responses";
const API_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const API_MODELS_URL = "https://api.x.ai/v1/models";

const LABEL = "xAI";
const DEFAULT_INTERVAL_S = 5;
const DEFAULT_EXPIRES_S = 15 * 60;
const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export const xai: AiProvider = {
  id: "xai",
  label: "Grok / xAI",
  authKinds: ["oauth", "api_key"],
  oauthConfigured: (env) => clientId(env) !== null,

  async startDeviceLogin(fetcher, env) {
    const client = requireClientId(env);
    const endpoints = await discover(fetcher);
    const response = await providerFetch(fetcher, LABEL, endpoints.device, {
      method: "POST",
      headers: FORM_HEADERS,
      body: formBody({ client_id: client, scope: OAUTH_SCOPE }),
    });
    await expectOk(response, LABEL);
    const body = (await readJson(response, LABEL)) as {
      device_code?: unknown;
      user_code?: unknown;
      verification_uri?: unknown;
      verification_uri_complete?: unknown;
      interval?: unknown;
      expires_in?: unknown;
    };
    const verificationUrl =
      typeof body.verification_uri_complete === "string"
        ? body.verification_uri_complete
        : body.verification_uri;
    if (
      typeof body.device_code !== "string" ||
      typeof body.user_code !== "string" ||
      typeof verificationUrl !== "string" ||
      // The person is sent there to sign in: nowhere but xAI's own sites
      // (`accounts.x.ai`, which is not the issuer's host).
      !xaiSite(verificationUrl)
    ) {
      throw new AiError("unavailable", `${LABEL} did not start a device login. Try again.`);
    }
    return {
      deviceId: body.device_code,
      userCode: body.user_code,
      verificationUrl,
      interval: seconds(body.interval, DEFAULT_INTERVAL_S),
      expiresAt: Date.now() + seconds(body.expires_in, DEFAULT_EXPIRES_S) * 1000,
    };
  },

  async pollDeviceLogin(fetcher, env, login): Promise<DevicePoll> {
    const client = requireClientId(env);
    const endpoints = await discover(fetcher);
    const response = await providerFetch(fetcher, LABEL, endpoints.token, {
      method: "POST",
      headers: FORM_HEADERS,
      body: formBody({ grant_type: DEVICE_GRANT, device_code: login.deviceId, client_id: client }),
    });
    if (response.ok) return { status: "granted", tokens: grantOf(await readJson(response, LABEL)) };
    const body = (await readJson(response, LABEL).catch(() => ({}))) as { error?: unknown };
    switch (body.error) {
      case "authorization_pending":
      case "slow_down":
        return { status: "pending" };
      case "expired_token":
        return { status: "expired" };
      case "access_denied":
        return { status: "denied" };
      default:
        throw new AiError("unavailable", `${LABEL} could not answer the device login. Try again.`);
    }
  },

  async refresh(fetcher, env, refreshToken) {
    const client = requireClientId(env);
    const endpoints = await discover(fetcher);
    const response = await providerFetch(fetcher, LABEL, endpoints.token, {
      method: "POST",
      headers: FORM_HEADERS,
      body: formBody({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: client,
      }),
    });
    if (response.status === 400 || response.status === 401) {
      const body = (await readJson(response, LABEL).catch(() => ({}))) as { error?: unknown };
      if (body.error === "invalid_grant" || response.status === 401) {
        throw new AiError(
          "reconnect",
          "xAI no longer accepts this account's authorization. Link it again from the settings.",
        );
      }
    }
    await expectOk(response, LABEL);
    return grantOf(await readJson(response, LABEL));
  },

  async validateKey(fetcher, key) {
    const response = await providerFetch(fetcher, LABEL, API_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new AiError("invalid_key", "xAI does not accept that API key.");
    }
    if (!response.ok)
      throw new AiError("unavailable", `${LABEL} could not check the key. Try again.`);
    return {};
  },

  async listModels(fetcher, credential) {
    const discovered = await discoverModels(fetcher, credential).catch(() => null);
    return discovered ? mergeModels("xai", discovered) : curatedModels("xai");
  },

  async generate(fetcher, credential, request) {
    const headers = { ...JSON_HEADERS, Authorization: `Bearer ${credential.access}` };
    const response = await providerFetch(fetcher, LABEL, API_RESPONSES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model,
        ...responsesInput(request.system, request.user),
        store: false,
      }),
      signal: request.signal,
      timeoutMs: GENERATE_TIMEOUT_MS,
    });
    if (response.status !== 404) {
      await expectOk(response, LABEL);
      return outputText(await readJson(response, LABEL));
    }
    // A deployment without the Responses endpoint still speaks chat completions.
    await response.text().catch(() => "");
    const fallback = await providerFetch(fetcher, LABEL, API_CHAT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      }),
      signal: request.signal,
      timeoutMs: GENERATE_TIMEOUT_MS,
    });
    await expectOk(fallback, LABEL);
    return chatCompletionText(await readJson(fallback, LABEL));
  },
};

function clientId(env: AiEnv): string | null {
  const id = env.XAI_OAUTH_CLIENT_ID?.trim();
  return id ? id : null;
}

function requireClientId(env: AiEnv): string {
  const id = clientId(env);
  if (id === null) {
    throw new AiError("unavailable", "This gateway offers xAI by API key only.");
  }
  return id;
}

interface Endpoints {
  device: string;
  token: string;
}

/**
 * The endpoints the issuer names for itself, and no others. The device code
 * and the refresh token are posted to the token endpoint, so a document that
 * named another host would be handing them over: the issuer must be the one
 * the document was fetched from (OpenID Connect Discovery 1.0 §4.3), and
 * each endpoint must be https on that same host.
 */
async function discover(fetcher: typeof fetch): Promise<Endpoints> {
  const response = await providerFetch(fetcher, LABEL, OIDC_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
  });
  await expectOk(response, LABEL);
  const body = (await readJson(response, LABEL)) as {
    issuer?: unknown;
    device_authorization_endpoint?: unknown;
    token_endpoint?: unknown;
  };
  if (typeof body.issuer !== "string" || !issuerUrl(body.issuer, true)) {
    throw new AiError("unavailable", `${LABEL} names another issuer. Use an API key.`);
  }
  if (
    typeof body.device_authorization_endpoint !== "string" ||
    typeof body.token_endpoint !== "string" ||
    !issuerUrl(body.device_authorization_endpoint) ||
    !issuerUrl(body.token_endpoint)
  ) {
    throw new AiError("unavailable", `${LABEL} does not offer a device login. Use an API key.`);
  }
  return { device: body.device_authorization_endpoint, token: body.token_endpoint };
}

/** Whether a URL is https on the issuer's host; as the issuer itself, whether it is the issuer. */
function issuerUrl(value: string, exact = false): boolean {
  const url = parsed(value);
  if (!url || url.origin !== OIDC_ISSUER) return false;
  return !exact || url.href.replace(/\/$/, "") === OIDC_ISSUER;
}

/** Whether a URL is https on `x.ai` or one of its subdomains. */
function xaiSite(value: string): boolean {
  const url = parsed(value);
  return (
    url !== null &&
    url.protocol === "https:" &&
    (url.hostname === "x.ai" || url.hostname.endsWith(".x.ai"))
  );
}

function parsed(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function discoverModels(fetcher: typeof fetch, credential: Credential) {
  const response = await providerFetch(fetcher, LABEL, API_MODELS_URL, {
    headers: { Accept: "application/json", Authorization: `Bearer ${credential.access}` },
  });
  await expectOk(response, LABEL);
  return listedModels(await readJson(response, LABEL)).filter((model) =>
    model.id.startsWith("grok-"),
  );
}

function grantOf(body: unknown): GrantedTokens {
  const raw = (body ?? {}) as {
    access_token?: unknown;
    refresh_token?: unknown;
    id_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof raw.access_token !== "string" || raw.access_token === "") {
    throw new AiError(
      "unavailable",
      `${LABEL} answered with something that is not a token. Try again.`,
    );
  }
  const id = typeof raw.id_token === "string" ? decodeJwtPayload(raw.id_token) : null;
  return {
    access: raw.access_token,
    refresh:
      typeof raw.refresh_token === "string" && raw.refresh_token !== ""
        ? raw.refresh_token
        : undefined,
    expiresAt:
      typeof raw.expires_in === "number" && raw.expires_in > 0
        ? Date.now() + raw.expires_in * 1000
        : undefined,
    accountLabel: stringClaim(id, "email") ?? stringClaim(id, "preferred_username"),
  };
}

function seconds(value: unknown, fallback: number): number {
  return typeof value === "number" && value > 0 ? Math.ceil(value) : fallback;
}
