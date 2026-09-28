import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "../../api.js";
import { type AiProviderView, aiApi, aiKeys } from "../../api-ai.js";
import { Dialog, DialogActions, DialogError, Field } from "../Dialog.js";
import { useToast } from "../toast.js";

/** Pasting an API key, which the gateway checks with the provider before keeping. */
export function AiKeyDialog({
  provider,
  onDone,
  onCancel,
}: {
  provider: AiProviderView | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={provider !== null}
      title={`Use an API key for ${provider?.label ?? ""}`}
      description="The key is checked with the provider, then stored encrypted. It is billed to the account it came from, not to a subscription."
      onCancel={onCancel}
    >
      {provider ? <KeyForm provider={provider} onDone={onDone} onCancel={onCancel} /> : null}
    </Dialog>
  );
}

function KeyForm({
  provider,
  onDone,
  onCancel,
}: {
  provider: AiProviderView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => aiApi.setKey(provider.id, key.trim()),
    onSuccess: async () => {
      toast(`${provider.label} is linked.`);
      await client.invalidateQueries({ queryKey: aiKeys.status });
      onDone();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim()) save.mutate();
      }}
    >
      <Field
        label="API key"
        type="password"
        value={key}
        onChange={setKey}
        disabled={save.isPending}
        autoFocus
        placeholder={provider.id === "openai" ? "sk-…" : "xai-…"}
      />
      <DialogError>
        {save.isError ? errorText(save.error, "The key was not accepted.") : null}
      </DialogError>
      <DialogActions>
        <button type="button" className="btn" disabled={save.isPending} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending || !key.trim()}>
          {save.isPending ? "Checking…" : "Save key"}
        </button>
      </DialogActions>
    </form>
  );
}
