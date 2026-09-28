import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { errorText } from "../../api.js";
import { type AiDeviceLogin, type AiProviderId, aiApi, aiKeys } from "../../api-ai.js";
import { CopyButton } from "../CopyButton.js";
import { Dialog, DialogActions, DialogError, DialogProgress } from "../Dialog.js";
import { useToast } from "../toast.js";

/**
 * Linking a subscription by device code: the provider shows a page, this
 * shows the code to type there, and the gateway asks the provider every few
 * seconds whether it was typed. Nothing of the person's password comes near
 * Exeora; the provider hands the gateway a token once they say yes.
 */
export function AiDeviceLoginDialog({
  provider,
  label,
  onDone,
  onCancel,
}: {
  provider: AiProviderId | null;
  label: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={provider !== null}
      title={`Link ${label}`}
      description="Open the page below, sign in there, and enter the code. This dialog closes on its own once the provider says yes."
      onCancel={onCancel}
    >
      {provider ? <DeviceLogin provider={provider} onDone={onDone} onCancel={onCancel} /> : null}
    </Dialog>
  );
}

function DeviceLogin({
  provider,
  onDone,
  onCancel,
}: {
  provider: AiProviderId;
  onDone: () => void;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [login, setLogin] = useState<AiDeviceLogin | null>(null);
  const [outcome, setOutcome] = useState<"pending" | "denied" | "expired">("pending");
  const timer = useRef<number | null>(null);

  const start = useMutation({
    mutationFn: () => aiApi.startDeviceLogin(provider),
    onSuccess: setLogin,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: started once per provider
  useEffect(() => {
    start.mutate();
  }, [provider]);

  useEffect(() => {
    if (!login || outcome !== "pending") return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      if (Date.now() > login.expiresAt) {
        setOutcome("expired");
        return;
      }
      try {
        const result = await aiApi.pollDeviceLogin(provider);
        if (stopped) return;
        if (result.status === "granted") {
          toast(`${provider === "openai" ? "ChatGPT" : "Grok"} is linked.`);
          await client.invalidateQueries({ queryKey: aiKeys.status });
          onDone();
          return;
        }
        if (result.status !== "pending") {
          setOutcome(result.status);
          return;
        }
      } catch (error) {
        if (stopped) return;
        toast(errorText(error, "The provider could not be asked."), "error");
      }
      timer.current = window.setTimeout(poll, Math.max(1, login.interval) * 1000);
    };
    timer.current = window.setTimeout(poll, Math.max(1, login.interval) * 1000);
    return () => {
      stopped = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [login, outcome, provider, client, toast, onDone]);

  return (
    <div>
      {login ? (
        <div className="border-border bg-bg mt-4 rounded-lg border p-4 text-center">
          <p className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
            Your code
          </p>
          <p className="text-headline-lg mt-1 font-mono tracking-[0.2em]" aria-live="polite">
            {login.userCode}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <a
              href={login.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
            >
              Open the provider's page
            </a>
            <CopyButton value={login.userCode} label="Copy code" />
          </div>
        </div>
      ) : null}
      <DialogError>
        {start.isError
          ? errorText(start.error, "The provider could not start the login.")
          : outcome === "denied"
            ? "The request was refused on the provider's page."
            : outcome === "expired"
              ? "The code expired before it was entered. Start again."
              : null}
      </DialogError>
      <DialogProgress>
        {start.isPending
          ? "Asking the provider for a code…"
          : outcome === "pending" && login
            ? "Waiting for the code to be entered…"
            : null}
      </DialogProgress>
      <DialogActions>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {outcome !== "pending" || start.isError ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setOutcome("pending");
              setLogin(null);
              start.mutate();
            }}
          >
            Try again
          </button>
        ) : null}
      </DialogActions>
    </div>
  );
}
