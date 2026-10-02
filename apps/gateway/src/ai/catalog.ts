import type { AiModel, AiProviderId } from "./providers/types.js";

/**
 * The models a provider is offered with before it is asked. A provider that
 * answers a listing adds to these; one that does not still offers these.
 * The first of each list is the model an operation uses until told otherwise.
 */
export const CURATED_MODELS: Record<AiProviderId, readonly AiModel[]> = {
  openai: [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.5-mini", label: "GPT-5.5 mini" },
    { id: "gpt-5.5-codex", label: "GPT-5.5 Codex" },
  ],
  xai: [
    { id: "grok-4-fast", label: "Grok 4 Fast" },
    { id: "grok-4", label: "Grok 4" },
    { id: "grok-code-fast-1", label: "Grok Code Fast 1" },
  ],
  // The local CLI owns the ChatGPT model catalog. Gateway settings may name
  // a model, but the empty list keeps the dashboard from inventing one here.
  chatgpt: [],
};

/** No listing is allowed to grow past this: a selector, not a catalogue. */
const MAX_MODELS = 50;

export function curatedModels(provider: AiProviderId): AiModel[] {
  return [...CURATED_MODELS[provider]];
}

export function defaultModel(provider: AiProviderId): string {
  // biome-ignore lint/style/noNonNullAssertion: every curated list has an entry
  return CURATED_MODELS[provider][0]!.id;
}

/**
 * The curated list first, in its order, then whatever the provider listed
 * that is not already there, by id. A provider's label wins over a curated
 * one only where the curated list has none.
 */
export function mergeModels(
  provider: AiProviderId,
  discovered: ReadonlyArray<{ id: string; label?: string | undefined }>,
): AiModel[] {
  const merged = curatedModels(provider);
  const known = new Set(merged.map((model) => model.id));
  const extra = discovered
    .filter((model) => !known.has(model.id) && known.add(model.id))
    .map((model) => ({ id: model.id, label: model.label ?? model.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...merged, ...extra].slice(0, MAX_MODELS);
}

/** Whether a model id names one of this provider's, curated or listed. Unknown ids are still accepted by the provider itself. */
export function isModelId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
}
