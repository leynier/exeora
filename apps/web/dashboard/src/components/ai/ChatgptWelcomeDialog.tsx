import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "../../api.js";
import { aiApi, type ChatgptStatus } from "../../api-ai.js";
import { Dialog, DialogActions } from "../Dialog.js";
import { CHATGPT_USAGE_URL } from "./chatgpt-state.js";

export type ChatgptWelcome = { deviceId: string; noticeId: string };

/** A welcome stays pending on the machine until the displayed explanation is acknowledged. */
export function ChatgptWelcomeDialog({
  welcome,
  onDone,
}: {
  welcome: ChatgptWelcome | null;
  onDone: () => void;
}) {
  // Mount per notice so pending/error state cannot leak to another account.
  return welcome ? (
    <WelcomeNotice
      key={`${welcome.deviceId}:${welcome.noticeId}`}
      welcome={welcome}
      onDone={onDone}
    />
  ) : null;
}

function WelcomeNotice({ welcome, onDone }: { welcome: ChatgptWelcome; onDone: () => void }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acknowledge = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await aiApi.chatgptWelcomeAck(welcome.deviceId, welcome.noticeId);
      if (result.acknowledged) {
        client.setQueriesData<ChatgptStatus>({ queryKey: ["ai", "chatgpt"] }, (status) =>
          status?.account?.noticeId === welcome.noticeId
            ? {
                ...status,
                account: { ...status.account, newRegistration: false, noticeId: undefined },
              }
            : status,
        );
      } else {
        // A stale notice can close; fetch the newer account's notice first.
        await client.invalidateQueries({ queryKey: ["ai", "chatgpt"] });
      }
      onDone();
    } catch (cause) {
      setError(errorText(cause, "The machine could not confirm this notice. Try again."));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      title="You're using your ChatGPT plan"
      description="When you choose ChatGPT, eligible AI requests on this machine use your ChatGPT plan. Exeora never receives your ChatGPT tokens."
      onCancel={() => void acknowledge()}
    >
      <p className="text-body-md text-foreground-muted mt-4">
        Manage usage in{" "}
        <a
          href={CHATGPT_USAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          ChatGPT settings
        </a>
        .
      </p>
      {error ? (
        <p role="alert" className="text-body-md text-error mt-4">
          {error}
        </p>
      ) : null}
      <DialogActions>
        {error ? (
          <button type="button" className="btn" disabled={pending} onClick={onDone}>
            Close for now
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => void acknowledge()}
        >
          {pending ? "Saving…" : error ? "Try again" : "Got it"}
        </button>
      </DialogActions>
    </Dialog>
  );
}
