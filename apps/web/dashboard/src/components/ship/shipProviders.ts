import type { AiOperation, AiProviderId, AiStatus } from "../../api-ai.js";

/** Resolve both operations before mutating the checkout. */
export function shipProviders(status: AiStatus): Record<AiOperation, AiProviderId | null> {
  const usable = status.enabled ? status.providers.filter((provider) => provider.linked) : [];
  const resolve = (operation: AiOperation): AiProviderId | null => {
    const configured =
      status.settings?.operations[operation].provider ?? status.settings?.defaultProvider;
    if (configured) return usable.find((provider) => provider.id === configured)?.id ?? null;
    return usable[0]?.id ?? null;
  };
  return { commit: resolve("commit"), pull_request: resolve("pull_request") };
}
