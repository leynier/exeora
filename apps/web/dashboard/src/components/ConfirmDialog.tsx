import { useEffect, useRef } from "react";

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
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      // Escape closes the dialog natively; `cancel` is where that surfaces.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="border-border bg-surface text-foreground m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border p-6 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <h2 className="text-title-lg">{title}</h2>
      <p className="text-body-md text-foreground-muted mt-2">{body}</p>

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={pending}>
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
