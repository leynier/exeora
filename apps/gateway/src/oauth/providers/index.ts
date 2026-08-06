import { github } from "./github.js";
import type { ProviderId, UpstreamProvider } from "./types.js";

/**
 * The whole registry. Adding Google is: write `google.ts`, add it here, widen
 * `ProviderId`, and set two secrets.
 */
const PROVIDERS: Record<ProviderId, UpstreamProvider> = {
  github,
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
