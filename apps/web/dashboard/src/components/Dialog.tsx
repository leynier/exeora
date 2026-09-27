import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * The frame of every dialog that is more than a yes or a no.
 *
 * Built on the native `<dialog>` for the same reason `ConfirmDialog` is: focus
 * trapping, Escape and the inertness of the page behind come from the
 * platform. The body is only mounted while the dialog is open, so whatever a
 * form held is gone when it closes and a dialog reopened starts clean, without
 * each form having to remember to reset itself.
 */
export function Dialog({
  open,
  title,
  description,
  wide = false,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  /** One or two sentences under the title, saying what the dialog does. */
  description?: ReactNode;
  wide?: boolean;
  /** Escape and the Cancel button. Refuse it while a request is in flight. */
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // Escape closes the dialog natively; `cancel` is where that surfaces.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className={`border-border bg-surface text-foreground m-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border p-6 backdrop:bg-black/60 backdrop:backdrop-blur-sm ${
        wide ? "w-[min(34rem,calc(100vw-2rem))]" : "w-[min(28rem,calc(100vw-2rem))]"
      }`}
    >
      <h2 id={titleId} className="text-title-lg">
        {title}
      </h2>
      {description && <p className="text-body-md text-foreground-muted mt-2">{description}</p>}
      {open ? children : null}
    </dialog>
  );
}

export const fieldClass =
  "border-border bg-bg text-foreground mt-2 w-full rounded-lg border px-3 py-2 font-mono text-xs";
export const fieldLabelClass =
  "text-label-md text-foreground-faint font-mono tracking-wide uppercase";

/** A labelled text input, in the one style every dialog uses. */
export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
  hint,
  autoFocus = false,
  className = "mt-3",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "url" | "password";
  placeholder?: string;
  disabled?: boolean;
  hint?: ReactNode;
  autoFocus?: boolean;
  className?: string;
}) {
  const hintId = useId();
  return (
    <div className={className}>
      <label className="block">
        <span className={fieldLabelClass}>{label}</span>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          aria-describedby={hint ? hintId : undefined}
          // A dialog is opened to be typed into, and the platform focuses the
          // first control anyway; this only says which one that should be.
          // biome-ignore lint/a11y/noAutofocus: inside a modal dialog
          autoFocus={autoFocus}
          className={fieldClass}
        />
      </label>
      {/* Beside the label and not inside it, so the field is named by its
          name and described by the rest. */}
      {hint && (
        <p id={hintId} className="text-body-md text-foreground-faint mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Why the gateway refused, inside the dialog that asked, where it can be acted on. */
export function DialogError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="border-error/30 bg-error/8 text-body-md text-error mt-4 rounded-lg border px-3 py-2"
    >
      {children}
    </p>
  );
}

/** What a request that takes a while is doing, announced as it changes. */
export function DialogProgress({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className="text-body-md text-foreground-muted mt-4">
      {children}
    </p>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap justify-end gap-2">{children}</div>;
}

/** Fields that most people never need, one click away. */
export function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="mt-4">
      <summary className="text-body-md text-foreground-muted hover:text-foreground">
        Advanced
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
