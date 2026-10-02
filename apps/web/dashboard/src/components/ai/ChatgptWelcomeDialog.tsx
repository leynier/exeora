import { Dialog, DialogActions } from "../Dialog.js";
import { CHATGPT_USAGE_URL } from "./chatgpt-state.js";

/** A one-time explanation shown after the first successful local registration. */
export function ChatgptWelcomeDialog({ open, onDone }: { open: boolean; onDone: () => void }) {
  return (
    <Dialog
      open={open}
      title="You're using your ChatGPT plan"
      description="When you choose ChatGPT, eligible AI requests on this machine use your ChatGPT plan. Exeora never receives your ChatGPT tokens."
      onCancel={onDone}
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
      <DialogActions>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Got it
        </button>
      </DialogActions>
    </Dialog>
  );
}
