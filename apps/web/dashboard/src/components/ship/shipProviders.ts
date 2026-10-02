import type { AiOperation, AiProviderId, AiStatus, ChatgptStatus } from "../../api-ai.js";

export type ShipProviders = Record<AiOperation, AiProviderId | null>;

/** Resolve before mutating the checkout; an explicit choice never falls back. */
export function shipProviders(
  status: AiStatus | undefined,
  chatgpt: ChatgptStatus | undefined,
): ShipProviders {
  const usable =
    status?.enabled === true
      ? status.providers.filter((provider) =>
          provider.id === "chatgpt"
            ? chatgpt?.state === "ready"
            : provider.linked !== null && !provider.linked.legacy,
        )
      : [];
  const resolve = (operation: AiOperation): AiProviderId | null => {
    const configured =
      status?.settings?.operations[operation].provider ?? status?.settings?.defaultProvider;
    if (configured)
      return usable.some((provider) => provider.id === configured) ? configured : null;
    return usable[0]?.id ?? null;
  };
  return { commit: resolve("commit"), pull_request: resolve("pull_request") };
}
