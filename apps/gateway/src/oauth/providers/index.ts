import { github } from "./github.js";
import { google } from "./google.js";
import type { ProviderId, UpstreamProvider } from "./types.js";

/**
 * The whole registry. Routes consume only this interface, so provider-specific
 * endpoints and response shapes stay in their own adapters.
 */
const PROVIDERS: Record<ProviderId, UpstreamProvider> = {
  github,
  google,
};

export function getProvider(id: string): UpstreamProvider | undefined {
  return Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as ProviderId] : undefined;
}

/** Providers whose secrets are present, for rendering the sign-in choices. */
export function configuredProviders(env: Env): UpstreamProvider[] {
  return Object.values(PROVIDERS).filter((provider) => provider.isConfigured(env));
}

export type { ProviderId, UpstreamIdentity, UpstreamProvider } from "./types.js";
export { UpstreamAuthError } from "./types.js";
