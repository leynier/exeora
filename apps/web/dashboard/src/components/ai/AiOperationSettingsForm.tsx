import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "../../api.js";
import {
  type AiOperation,
  type AiProviderId,
  type AiProviderView,
  type AiSettings,
  aiApi,
  aiKeys,
} from "../../api-ai.js";
import { fieldClass, fieldLabelClass } from "../Dialog.js";
import { Select } from "../Select.js";
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

/**
 * Which provider and model each operation uses, and what else to tell it:
 * conventions, a language, a tone. Saved as a whole; the default provider
 * is what a button uses when the operation names none.
 */
export function AiOperationSettingsForm({
  providers,
  settings,
}: {
  providers: AiProviderView[];
  settings: AiSettings;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<AiSettings>(settings);
  const save = useMutation({
    mutationFn: () =>
      aiApi.saveSettings({
        defaultProvider: draft.defaultProvider,
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
  const providerOptions = [
    { value: "", label: "Default provider" },
    ...providers.map((provider) => ({ value: provider.id, label: provider.label })),
  ];
  const modelsOf = (provider: AiProviderId | null) =>
    providers.find((item) => item.id === (provider ?? draft.defaultProvider ?? providers[0]?.id))
      ?.models ?? [];
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
      {providers.length > 1 ? (
        <div className="block">
          <span className={fieldLabelClass}>Default provider</span>
          <div className="mt-2">
            <Select
              label="Default provider"
              value={draft.defaultProvider ?? providers[0]?.id ?? ""}
              options={providers.map((provider) => ({ value: provider.id, label: provider.label }))}
              onChange={(value) =>
                setDraft((current) => ({ ...current, defaultProvider: value as AiProviderId }))
              }
            />
          </div>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {OPERATIONS.map((operation) => {
          const current = draft.operations[operation.id];
          const models = modelsOf(current.provider);
          return (
            <fieldset key={operation.id} className="border-border-subtle rounded-lg border p-3">
              <legend className="text-title-md px-1">{operation.label}</legend>
              <p className="text-body-md text-foreground-faint">{operation.hint}</p>
              {providers.length > 1 ? (
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
                <span className={fieldLabelClass}>Model</span>
                <div className="mt-2">
                  <Select
                    label={`${operation.label} model`}
                    value={current.model ?? ""}
                    options={[
                      { value: "", label: `Default (${models[0]?.label ?? "provider's choice"})` },
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
