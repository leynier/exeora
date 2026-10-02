import { curatedModels, mergeModels } from "../catalog.js";
import {
  expectOk,
  GENERATE_TIMEOUT_MS,
  listedModels,
  outputText,
  providerFetch,
  readJson,
  responsesInput,
} from "./http.js";
import { AiError, type AiProvider, type Credential } from "./types.js";

/**
 * OpenAI's documented API-key integration.
 *
 * ChatGPT plan sign-in is owned by the local CLI. The gateway deliberately has
 * no OAuth or device-login implementation for OpenAI: a credential row left by
 * the retired flow is handled as legacy by `credentials.ts` and is never opened
 * or sent to a provider endpoint.
 */

const API_RESPONSES_URL = "https://api.openai.com/v1/responses";
const API_MODELS_URL = "https://api.openai.com/v1/models";

const LABEL = "OpenAI API";
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export const openai: AiProvider = {
  id: "openai",
  label: LABEL,
  authKinds: ["api_key"],

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
    requireApiKey(credential);
    const discovered = await discoverModels(fetcher, credential).catch(() => null);
    return discovered ? mergeModels("openai", discovered) : curatedModels("openai");
  },

  async generate(fetcher, credential, request) {
    requireApiKey(credential);
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
  },
};

/** Legacy OpenAI OAuth rows must never be routed as API-key credentials. */
function requireApiKey(credential: Credential): void {
  if (credential.kind !== "api_key") {
    throw new AiError(
      "legacy",
      "The old ChatGPT sign-in is no longer supported. Use an OpenAI API key or sign in with ChatGPT on your machine.",
    );
  }
}

async function discoverModels(fetcher: typeof fetch, credential: Credential) {
  requireApiKey(credential);
  const response = await providerFetch(fetcher, LABEL, API_MODELS_URL, {
    headers: { Accept: "application/json", Authorization: `Bearer ${credential.access}` },
  });
  await expectOk(response, LABEL);
  const listed = listedModels(await readJson(response, LABEL));
  return listed.filter(
    (model) =>
      /^gpt-\d/.test(model.id) &&
      !/audio|realtime|image|tts|transcribe|search|embedding|moderation/.test(model.id),
  );
}
