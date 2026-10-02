import { curatedModels, mergeModels } from "../catalog.js";
import {
  expectOk,
  formBody,
  GENERATE_TIMEOUT_MS,
  listedModels,
  MAX_OUTPUT_TEXT_CHARS,
  outputItemsText,
  outputText,
  providerFetch,
  readJson,
  responsesInput,
} from "./http.js";
import { decodeJwtPayload, stringClaim, tokenExpiresAt } from "./jwt.js";
import { sseEvents } from "./sse.js";
import {
  AiError,
  type AiProvider,
  type Credential,
  type DeviceLogin,
  type DevicePoll,
  type GrantedTokens,
} from "./types.js";

/**
 * ChatGPT and the OpenAI API.
 *
 * An API key speaks to the documented API. A ChatGPT subscription has no
 * documented way in for a third party, so the OAuth path is the one the
 * Codex CLI uses: its public client id, a device code entered on OpenAI's
 * page, and the backend that Codex itself talks to. Every address and header
 * below is UNOFFICIAL, observed rather than promised, and may stop working
 * without notice. Whoever runs a gateway switches it on knowingly, with
 * `AI_ASSIST_PROVIDERS`, and off again with `AI_ASSIST_OAUTH=off`.
 */

// Unofficial: the Codex CLI's public OAuth client.
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
// Unofficial: where Codex starts and polls a device login.
const DEVICE_USERCODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
// Unofficial: the page where the person types the code.
const DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
// Unofficial: the token endpoint the device grant is exchanged and refreshed at.
const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
// Codex's device grant uses its hosted callback, not the browser-login loopback.
const OAUTH_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
// Unofficial: the backend Codex generates with, and the headers it identifies itself by.
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const CODEX_HEADERS = { "OpenAI-Beta": "responses=experimental", originator: "codex_cli_rs" };
// Unofficial: the claim that names the ChatGPT account inside the tokens.
const AUTH_CLAIM = "https://api.openai.com/auth";
// Documented: the OpenAI API.
const API_RESPONSES_URL = "https://api.openai.com/v1/responses";
const API_MODELS_URL = "https://api.openai.com/v1/models";

const LABEL = "OpenAI";
const DEFAULT_INTERVAL_S = 5;
const DEFAULT_EXPIRES_S = 15 * 60;
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export const openai: AiProvider = {
  id: "openai",
  label: "ChatGPT / OpenAI",
  authKinds: ["oauth", "api_key"],

  async startDeviceLogin(fetcher) {
    const response = await providerFetch(fetcher, LABEL, DEVICE_USERCODE_URL, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });
    await expectOk(response, LABEL);
    const body = (await readJson(response, LABEL)) as {
      device_auth_id?: unknown;
      user_code?: unknown;
      interval?: unknown;
      expires_in?: unknown;
    };
    if (typeof body.device_auth_id !== "string" || typeof body.user_code !== "string") {
      throw new AiError("unavailable", `${LABEL} did not start a device login. Try again.`);
    }
    return {
      deviceId: body.device_auth_id,
      userCode: body.user_code,
      verificationUrl: DEVICE_VERIFICATION_URL,
      interval: seconds(body.interval, DEFAULT_INTERVAL_S),
      expiresAt: Date.now() + seconds(body.expires_in, DEFAULT_EXPIRES_S) * 1000,
    };
  },

  async pollDeviceLogin(fetcher, _env, login: DeviceLogin): Promise<DevicePoll> {
    const response = await providerFetch(fetcher, LABEL, DEVICE_TOKEN_URL, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ device_auth_id: login.deviceId, user_code: login.userCode }),
    });
    // Codex polls through 403 and 404: both say "not yet".
    if (response.status === 403 || response.status === 404) {
      await response.text().catch(() => "");
      return { status: "pending" };
    }
    if (response.status === 400 || response.status === 410) {
      await response.text().catch(() => "");
      return { status: "expired" };
    }
    await expectOk(response, LABEL);
    const body = (await readJson(response, LABEL)) as {
      authorization_code?: unknown;
      code_verifier?: unknown;
    };
    if (typeof body.authorization_code !== "string" || typeof body.code_verifier !== "string") {
      throw new AiError(
        "unavailable",
        `${LABEL} answered the device login with no grant. Try again.`,
      );
    }
    const tokens = await exchange(fetcher, {
      grant_type: "authorization_code",
      code: body.authorization_code,
      code_verifier: body.code_verifier,
      client_id: CODEX_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
    });
    return { status: "granted", tokens };
  },

  async refresh(fetcher, _env, refreshToken) {
    return exchange(fetcher, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
    });
  },

  async validateKey(fetcher, key) {
    const response = await providerFetch(fetcher, LABEL, API_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    await response.text().catch(() => "");
    if (response.status === 401) {
      throw new AiError("invalid_key", "OpenAI does not accept that API key.");
    }
    if (!response.ok)
      throw new AiError("unavailable", `${LABEL} could not check the key. Try again.`);
    return {};
  },

  async listModels(fetcher, credential) {
    const discovered = await discoverModels(fetcher, credential).catch(() => null);
    return discovered ? mergeModels("openai", discovered) : curatedModels("openai");
  },

  async generate(fetcher, credential, request) {
    if (credential.kind === "api_key") {
      const response = await providerFetch(fetcher, LABEL, API_RESPONSES_URL, {
        method: "POST",
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${credential.access}` },
        body: JSON.stringify({
          model: request.model,
          ...responsesInput(request.system, request.user),
          store: false,
        }),
        signal: request.signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      });
      await expectOk(response, LABEL);
      return outputText(await readJson(response, LABEL));
    }
    const response = await providerFetch(fetcher, LABEL, CODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...CODEX_HEADERS,
        Accept: "text/event-stream",
        ...codexAuth(credential),
      },
      body: JSON.stringify({
        model: request.model,
        ...responsesInput(request.system, request.user),
        store: false,
        stream: true,
      }),
      signal: request.signal,
      timeoutMs: GENERATE_TIMEOUT_MS,
    });
    await expectOk(response, LABEL);
    if (!response.body) throw new AiError("unavailable", `${LABEL} returned no response stream.`);
    return streamedText(response.body);
  },
};

function codexAuth(credential: Credential): Record<string, string> {
  return {
    Authorization: `Bearer ${credential.access}`,
    ...(credential.accountId ? { "chatgpt-account-id": credential.accountId } : {}),
  };
}

/**
 * Canonical completed output, or completed deltas when output is omitted.
 */
async function streamedText(body: ReadableStream<Uint8Array>): Promise<string> {
  const deltas: string[] = [];
  let length = 0;
  try {
    for await (const event of sseEvents(body)) {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        continue;
      }
      if (data === null || typeof data !== "object") continue;
      const frame = data as { type?: unknown; delta?: unknown; response?: { output?: unknown } };
      const type = event.event ?? frame.type;
      if (type === "response.output_text.delta" && typeof frame.delta === "string") {
        length += frame.delta.length;
        if (length > MAX_OUTPUT_TEXT_CHARS) {
          await body.cancel().catch(() => undefined);
          throw new AiError("unavailable", "The AI provider returned too much text. Try again.");
        }
        deltas.push(frame.delta);
      } else if (type === "response.completed") {
        const completed = outputItemsText(frame.response?.output);
        return completed || deltas.join("");
      } else if (type === "response.failed" || type === "response.incomplete" || type === "error") {
        throw new AiError("unavailable", `${LABEL} could not complete the response. Try again.`);
      }
    }
    throw new AiError("unavailable", `${LABEL} did not complete the response. Try again.`);
  } finally {
    await body.cancel().catch(() => undefined);
  }
}

async function discoverModels(fetcher: typeof fetch, credential: Credential) {
  const url = credential.kind === "api_key" ? API_MODELS_URL : CODEX_MODELS_URL;
  const response = await providerFetch(fetcher, LABEL, url, {
    headers: {
      Accept: "application/json",
      ...(credential.kind === "api_key"
        ? { Authorization: `Bearer ${credential.access}` }
        : { ...CODEX_HEADERS, ...codexAuth(credential) }),
    },
  });
  await expectOk(response, LABEL);
  const listed = listedModels(await readJson(response, LABEL));
  // The API lists everything it serves; only the text models are of use here.
  return credential.kind === "api_key"
    ? listed.filter(
        (model) =>
          /^gpt-\d/.test(model.id) &&
          !/audio|realtime|image|tts|transcribe|search|embedding|moderation/.test(model.id),
      )
    : listed;
}

async function exchange(
  fetcher: typeof fetch,
  fields: Record<string, string>,
): Promise<GrantedTokens> {
  const response = await providerFetch(fetcher, LABEL, OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody(fields),
  });
  if (response.status === 400 || response.status === 401) {
    const body = (await readJson(response, LABEL).catch(() => ({}))) as { error?: unknown };
    if (body.error === "invalid_grant" || response.status === 401) {
      throw new AiError(
        "reconnect",
        "ChatGPT no longer accepts this account's authorization. Link it again from the settings.",
      );
    }
  }
  await expectOk(response, LABEL);
  return grantOf(await readJson(response, LABEL));
}

/** The grant out of a token answer, with the account read from the tokens themselves. */
export function grantOf(body: unknown): GrantedTokens {
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
  const access = decodeJwtPayload(raw.access_token);
  const id = typeof raw.id_token === "string" ? decodeJwtPayload(raw.id_token) : null;
  const expiresIn =
    typeof raw.expires_in === "number" && Number.isFinite(raw.expires_in) && raw.expires_in > 0
      ? Date.now() + raw.expires_in * 1000
      : undefined;
  const claimExpiry = tokenExpiresAt(raw.access_token);
  const expiresAt =
    expiresIn !== undefined && claimExpiry !== undefined
      ? Math.min(expiresIn, claimExpiry)
      : (expiresIn ?? claimExpiry);
  return {
    access: raw.access_token,
    refresh:
      typeof raw.refresh_token === "string" && raw.refresh_token !== ""
        ? raw.refresh_token
        : undefined,
    expiresAt,
    accountId:
      stringClaim(access, AUTH_CLAIM, "chatgpt_account_id") ??
      stringClaim(id, AUTH_CLAIM, "chatgpt_account_id"),
    accountLabel: stringClaim(id, "email") ?? stringClaim(access, "email"),
  };
}

function seconds(value: unknown, fallback: number): number {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? Math.min(Math.ceil(number), DEFAULT_EXPIRES_S)
    : fallback;
}
