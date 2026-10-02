import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../api.js";
import {
  type AiModel,
  type AiOperation,
  type AiProviderId,
  type AiProviderView,
  type AiSettings,
  aiApi,
  aiKeys,
} from "../../api-ai.js";
import { fieldClass, fieldLabelClass } from "../Dialog.js";
import { Select, type SelectOption } from "../Select.js";
import { useToast } from "../toast.js";

const OPERATIONS: { id: AiOperation; label: string; hint: string }[] = [
  { id: "commit", label: "Commit messages", hint: "From the staged patch." },
  {
    id: "pull_request",
    label: "Pull requests",
    hint: "From the commits and patch against the base branch.",
  },
];

const MAX_INSTRUCTIONS = 4000;

export interface ChatgptModelSource {
  deviceId: string;
  machineName: string;
  models: AiModel[];
  loading: boolean;
}

export interface ChatgptMachineOption {
  deviceId: string;
  machineName: string;
}

/** A lone local ChatGPT provider must become an explicit saved default. */
export function defaultProviderOnSave(
  defaultProvider: AiProviderId | null,
  providers: readonly AiProviderView[],
): AiProviderId | null {
  if (defaultProvider) return defaultProvider;
  return providers.length === 1 && providers[0]?.id === "chatgpt" ? "chatgpt" : null;
}

/**
 * Which provider and model each operation uses, and what else to tell it:
 * conventions, a language, a tone. Saved as a whole; the default provider
 * is what a button uses when the operation names none.
 */
export function AiOperationSettingsForm({
  providers,
  settings,
  chatgptModels = [],
  chatgptMachines = [],
  chatgptMachineId,
  onChatgptMachineChange,
}: {
  providers: AiProviderView[];
  settings: AiSettings;
  chatgptModels?: readonly ChatgptModelSource[];
  chatgptMachines?: readonly ChatgptMachineOption[];
  chatgptMachineId?: string;
  onChatgptMachineChange?: (deviceId: string) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [localChatgptMachineId, setLocalChatgptMachineId] = useState<string>(
    chatgptModels[0]?.deviceId ?? "",
  );
  const machineOptions = chatgptMachines.length > 0 ? chatgptMachines : chatgptModels;
  const selectedChatgptMachineId = chatgptMachineId ?? localChatgptMachineId;
  const setChatgptMachine = useCallback(
    (deviceId: string) => {
      if (onChatgptMachineChange) onChatgptMachineChange(deviceId);
      else setLocalChatgptMachineId(deviceId);
    },
    [onChatgptMachineChange],
  );
  const soleChatgpt = providers.length === 1 && providers[0]?.id === "chatgpt";
  const effectiveDefaultProvider =
    draft.defaultProvider ?? (soleChatgpt ? ("chatgpt" as const) : null);
  const save = useMutation({
    mutationFn: () =>
      aiApi.saveSettings({
        defaultProvider: defaultProviderOnSave(draft.defaultProvider, providers),
        operations: {
          commit: draft.operations.commit,
          pull_request: draft.operations.pull_request,
        },
      }),
    onSuccess: (saved) => {
      setDraft(saved);
      toast("AI Assist settings saved.");
      void client.invalidateQueries({ queryKey: aiKeys.status });
    },
    onError: (error) => toast(errorText(error, "The settings could not be saved."), "error"),
  });
  const retainedProviders = [
    draft.defaultProvider,
    ...OPERATIONS.map(({ id }) => draft.operations[id].provider),
  ].filter(
    (id): id is AiProviderId => id !== null && !providers.some((provider) => provider.id === id),
  );
  const providerLabels: Record<AiProviderId, string> = {
    openai: "OpenAI API",
    xai: "Grok",
    chatgpt: "ChatGPT plan",
  };
  const providerOptions: SelectOption[] = [
    { value: "", label: "Default provider" },
    ...providers.map((provider) => ({ value: provider.id, label: provider.label })),
    ...Array.from(new Set(retainedProviders), (id) => ({
      value: id,
      label: `${providerLabels[id]} (not linked)`,
      disabled: true,
    })),
  ];
  useEffect(() => {
    if (!machineOptions.some((source) => source.deviceId === selectedChatgptMachineId)) {
      setChatgptMachine(machineOptions[0]?.deviceId ?? "");
    }
  }, [machineOptions, selectedChatgptMachineId, setChatgptMachine]);
  const modelsOf = (provider: AiProviderId | null) => {
    const id = provider ?? effectiveDefaultProvider ?? providers[0]?.id;
    if (id === "chatgpt") {
      return (
        chatgptModels.find((source) => source.deviceId === selectedChatgptMachineId)?.models ?? []
      );
    }
    return providers.find((item) => item.id === id)?.models ?? [];
  };
  const setOperation = (
    operation: AiOperation,
    patch: Partial<AiSettings["operations"][AiOperation]>,
  ) =>
    setDraft((current) => ({
      ...current,
      operations: {
        ...current.operations,
        [operation]: { ...current.operations[operation], ...patch },
      },
    }));

  return (
    <form
      className="px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {providers.length > 1 || soleChatgpt || draft.defaultProvider !== null ? (
        <div className="block">
          <span className={fieldLabelClass}>Default provider</span>
          <div className="mt-2">
            <Select
              label="Default provider"
              value={draft.defaultProvider ?? (soleChatgpt ? "chatgpt" : "")}
              options={providerOptions}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  defaultProvider: value ? (value as AiProviderId) : null,
                }))
              }
            />
          </div>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {OPERATIONS.map((operation) => {
          const current = draft.operations[operation.id];
          const operationProvider = current.provider ?? effectiveDefaultProvider;
          const models = modelsOf(current.provider);
          const chatgptSource = chatgptModels.find(
            (source) => source.deviceId === selectedChatgptMachineId,
          );
          return (
            <fieldset key={operation.id} className="border-border-subtle rounded-lg border p-3">
              <legend className="text-title-md px-1">{operation.label}</legend>
              <p className="text-body-md text-foreground-faint">{operation.hint}</p>
              {providers.length > 1 || current.provider !== null ? (
                <div className="mt-3">
                  <span className={fieldLabelClass}>Provider</span>
                  <div className="mt-2">
                    <Select
                      label={`${operation.label} provider`}
                      value={current.provider ?? ""}
                      options={providerOptions}
                      onChange={(value) =>
                        setOperation(operation.id, {
                          provider: value ? (value as AiProviderId) : null,
                          model: null,
                        })
                      }
                      wide
                    />
                  </div>
                </div>
              ) : null}
              <div className="mt-3">
                {operationProvider === "chatgpt" && machineOptions.length > 1 ? (
                  <div className="mb-3">
                    <span className={fieldLabelClass}>ChatGPT machine for model list</span>
                    <div className="mt-2">
                      <Select
                        label={`${operation.label} ChatGPT machine`}
                        value={selectedChatgptMachineId}
                        options={machineOptions.map((source) => ({
                          value: source.deviceId,
                          label: source.machineName,
                        }))}
                        onChange={setChatgptMachine}
                        wide
                      />
                    </div>
                  </div>
                ) : null}
                <span className={fieldLabelClass}>Model</span>
                <div className="mt-2">
                  <Select
                    label={`${operation.label} model`}
                    value={current.model ?? ""}
                    options={[
                      {
                        value: "",
                        label:
                          operationProvider === "chatgpt"
                            ? `First available on ${chatgptSource?.machineName ?? "the machine"}`
                            : `Default (${models[0]?.label ?? "provider's choice"})`,
                      },
                      ...models.map((model) => ({ value: model.id, label: model.label })),
                    ]}
                    onChange={(value) => setOperation(operation.id, { model: value || null })}
                    wide
                  />
                </div>
              </div>
              <label className="mt-3 block">
                <span className={fieldLabelClass}>Instructions</span>
                <textarea
                  value={current.instructions ?? ""}
                  maxLength={MAX_INSTRUCTIONS}
                  rows={3}
                  placeholder="Conventions to follow, a language to write in…"
                  className={`${fieldClass} resize-y`}
                  onChange={(event) =>
                    setOperation(operation.id, { instructions: event.target.value || null })
                  }
                />
              </label>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
