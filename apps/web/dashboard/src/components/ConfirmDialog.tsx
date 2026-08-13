import { useEffect, useId, useRef, useState } from "react";

/**
 * A confirmation that names its consequence.
 *
 * Built on the native `<dialog>` so focus trapping, Escape and inertness of
 * the page behind come from the platform rather than from us. It replaces
 * `window.confirm`, which cannot say which machine is about to be cut off and
 * which the browser is free to style however it likes.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmText,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /**
   * When set, the action stays out of reach until this exact string is typed.
   *
   * For the one deletion that takes the whole account: a dialog whose only
   * defence is a button in the right place is one misclick from irreversible,
   * and typing an address is a moment of reading rather than of aim.
   */
  confirmText?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    // Cleared on every open, so a dialog dismissed and reopened does not come
    // back already satisfied.
    if (open) setTyped("");
  }, [open]);

  const blocked = confirmText !== undefined && typed !== confirmText;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Escape closes the dialog natively; `cancel` is where that surfaces.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="border-border bg-surface text-foreground m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border p-6 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 id={titleId} className="text-title-lg">
        {title}
      </h2>
      <p id={bodyId} className="text-body-md text-foreground-muted mt-2">
        {body}
      </p>

      {confirmText !== undefined && (
        <label className="mt-4 block">
          <span className="text-body-md text-foreground-muted">
            Type <code className="font-mono">{confirmText}</code> to confirm
          </span>
          <input
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            disabled={pending}
            autoComplete="off"
            className="border-border bg-bg text-foreground mt-2 w-full rounded-lg border px-3 py-2 font-mono"
          />
        </label>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={onConfirm}
          disabled={pending || blocked}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
