import { AI_PROVIDER_IDS } from "../../db/schema-ai.js";
import { openai } from "./openai.js";
import type { AiAuthKind, AiEnv, AiProvider, AiProviderId } from "./types.js";
import { xai } from "./xai.js";

/**
 * The providers, and which of them this gateway offers.
 *
 * Both flows that link a subscription are unofficial (see each provider), so
 * nothing is offered until whoever runs the gateway names it in
 * `AI_ASSIST_PROVIDERS`. `AI_ASSIST_OAUTH=off` keeps the API keys and drops
 * the device logins. Without `CLOUD_CREDENTIALS_KEY` there is nowhere safe
 * to keep any of it, and the feature is off as it is for GitHub.
 */

const PROVIDERS: Record<AiProviderId, AiProvider> = { openai, xai };

export interface OfferedProvider {
  provider: AiProvider;
  /** What this gateway lets the account link with. */
  authKinds: AiAuthKind[];
}

export interface AiConfig {
  /** `CLOUD_CREDENTIALS_KEY`, under which every credential is kept. */
  credentialsKey: string;
  offered: OfferedProvider[];
}

export function isProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** The configuration, or null on a gateway where AI Assist is off. */
export function aiConfig(env: AiEnv): AiConfig | null {
  const credentialsKey = env.CLOUD_CREDENTIALS_KEY?.trim();
  if (!credentialsKey) return null;
  const named = (env.AI_ASSIST_PROVIDERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(isProviderId);
  const ids = [...new Set(named)];
  if (ids.length === 0) return null;
  const oauthOff = env.AI_ASSIST_OAUTH?.trim().toLowerCase() === "off";
  const offered = ids.map((id) => {
    const provider = PROVIDERS[id];
    const oauth = !oauthOff && (provider.oauthConfigured?.(env) ?? true);
    return {
      provider,
      authKinds: provider.authKinds.filter((kind) => kind !== "oauth" || oauth),
    };
  });
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
