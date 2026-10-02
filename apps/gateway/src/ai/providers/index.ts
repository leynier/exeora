import { AI_PROVIDER_IDS } from "../../db/schema-ai.js";
import { openai } from "./openai.js";
import type { AiAuthKind, AiEnv, AiProvider, AiProviderId } from "./types.js";
import { xai } from "./xai.js";

/**
 * The providers, and which of them this gateway offers.
 *
 * The local ChatGPT plan is offered only when the gateway names it in
 * `AI_ASSIST_PROVIDERS`; it never creates a gateway credential. Without
 * `CLOUD_CREDENTIALS_KEY` there is nowhere safe to keep the other providers;
 * a ChatGPT-only deployment can still use its local machine-bound provider.
 */

/**
 * The machine-bound entry is intentionally a structural provider only. The
 * dedicated ChatGPT routes dispatch to the local CLI; these methods are
 * unreachable and fail closed if a caller forgets that boundary.
 */
const chatgpt: AiProvider = {
  id: "chatgpt",
  label: "ChatGPT plan",
  authKinds: [],
  machineBound: true,
  startDeviceLogin: async () => {
    throw new Error("ChatGPT sign-in belongs to the local Exeora CLI.");
  },
  pollDeviceLogin: async () => {
    throw new Error("ChatGPT sign-in belongs to the local Exeora CLI.");
  },
  refresh: async () => {
    throw new Error("ChatGPT credentials never enter the gateway.");
  },
  validateKey: async () => {
    throw new Error("ChatGPT plan does not use a gateway API key.");
  },
  listModels: async () => {
    throw new Error("ChatGPT models are listed by the local Exeora CLI.");
  },
  generate: async () => {
    throw new Error("ChatGPT generation belongs to the local Exeora CLI.");
  },
};

const PROVIDERS: Record<AiProviderId, AiProvider> = { openai, xai, chatgpt };

export interface OfferedProvider {
  provider: AiProvider;
  /** What this gateway lets the account link with. */
  authKinds: AiAuthKind[];
}

export interface AiConfig {
  /** `CLOUD_CREDENTIALS_KEY`, or an empty string when only machine-bound providers are enabled. */
  credentialsKey: string;
  offered: OfferedProvider[];
}

export function isProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** The configuration, or null on a gateway where AI Assist is off. */
export function aiConfig(env: AiEnv): AiConfig | null {
  const credentialsKey = env.CLOUD_CREDENTIALS_KEY?.trim() ?? "";
  const named = (env.AI_ASSIST_PROVIDERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(isProviderId);
  const ids = [...new Set(named)];
  if (ids.length === 0) return null;
  const oauthOff = env.AI_ASSIST_OAUTH?.trim().toLowerCase() === "off";
  const offered = ids
    // A machine-bound provider never writes a credential. Providers that do
    // write one are unavailable until the encryption key is configured.
    .filter((id) => credentialsKey !== "" || PROVIDERS[id].machineBound === true)
    .map((id) => {
      const provider = PROVIDERS[id];
      // The kill switch is deliberately scoped to xAI. OpenAI is API-key only
      // and ChatGPT is local-machine bound, so neither should disappear when a
      // deployment disables Grok OAuth.
      const oauth = id === "xai" ? !oauthOff && (provider.oauthConfigured?.(env) ?? true) : true;
      return {
        provider,
        authKinds: provider.authKinds.filter((kind) => kind !== "oauth" || oauth),
      };
    });
  if (offered.length === 0) return null;
  return { credentialsKey, offered };
}

/** The provider as offered, or null when this gateway does not offer it. */
export function offeredProvider(config: AiConfig, id: string): OfferedProvider | null {
  return config.offered.find((entry) => entry.provider.id === id) ?? null;
}

/** Whether any offered provider can be linked by device login. */
export function oauthAvailable(config: AiConfig): boolean {
  return config.offered.some((entry) => entry.authKinds.includes("oauth"));
}
