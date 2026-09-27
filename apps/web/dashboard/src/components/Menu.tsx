import { useCallback, useEffect, useId, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  /** Drawn in the error colour: it removes something. */
  danger?: boolean;
  disabled?: boolean;
};

/**
 * The secondary actions of a row, behind one button.
 *
 * A row shows its name, its state and the one thing most people came to do.
 * Everything else lives here, so a list of ten rows is not a wall of thirty
 * buttons with the destructive ones a slip away from the useful ones.
 *
 * Built on `popover` like `Select`, for the same reasons: the top layer keeps
 * the menu from being clipped by its card, and Escape, dismissal on a click
 * elsewhere and focus returning to the button come from the platform.
 */
export function Menu({
  label,
  items,
  disabled = false,
}: {
  /** Names the button for screen readers: "Actions for laptop". */
  label: string;
  items: readonly MenuItem[];
  disabled?: boolean;
}) {
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  /** Hangs the menu from the button's right edge, flipping to stay on screen. */
  const place = useCallback(() => {
    const button = trigger.current;
    const menu = panel.current;
    if (!button || !menu) return;

    const anchor = button.getBoundingClientRect();
    const gap = 6;
    const menuRect = menu.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom;
    const flip = below < menuRect.height + gap && anchor.top > below;

    menu.style.top = `${flip ? anchor.top - menuRect.height - gap : anchor.bottom + gap}px`;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - menuRect.width, window.innerWidth - menuRect.width - 8))}px`;
  }, []);

  useEffect(() => {
    const menu = panel.current;
    if (!menu) return;

    const onToggle = (event: Event) => {
      const opening = (event as ToggleEvent).newState === "open";
      setOpen(opening);
      if (!opening) return;
      place();
      menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    };

    menu.addEventListener("toggle", onToggle);
    return () => menu.removeEventListener("toggle", onToggle);
  }, [place]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (disabled) panel.current?.hidePopover();
  }, [disabled]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={disabled ? undefined : panelId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={`border-border duration-fast inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          open ? "bg-surface-variant text-foreground" : "text-foreground-muted"
        } hover:bg-surface-variant hover:text-foreground disabled:pointer-events-none disabled:opacity-50`}
        onKeyDown={(event) => {
          if (disabled || open || event.key !== "ArrowDown") return;
          event.preventDefault();
          panel.current?.showPopover();
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="size-4">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>

      <div
        ref={panel}
        id={panelId}
        popover="auto"
        role="menu"
        aria-label={label}
        className="popover-panel border-border bg-surface-elevated fixed inset-auto m-0 min-w-44 rounded-lg border p-1 shadow-xl shadow-black/40"
        onKeyDown={(event) => {
          const entries = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ),
          ];
          const from = entries.indexOf(document.activeElement as HTMLButtonElement);
          const step = { ArrowDown: from + 1, ArrowUp: from - 1, Home: 0, End: entries.length - 1 }[
            event.key
          ];
          if (step === undefined) return;
          event.preventDefault();
          entries[(step + entries.length) % entries.length]?.focus();
        }}
        // Tabbing out of the menu closes it; focus moving between its items
        // must not. React's onBlur is focusout, so it sees both.
        onBlur={(event) => {
          if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
            panel.current?.hidePopover();
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`text-body-md duration-fast flex w-full items-center rounded-md px-2.5 py-1.5 text-left transition-colors focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
              item.danger
                ? "text-error hover:bg-error/10 focus-visible:bg-error/10"
                : "text-foreground-muted hover:bg-surface-variant hover:text-foreground focus-visible:bg-surface-variant focus-visible:text-foreground"
            }`}
            onClick={() => {
              panel.current?.hidePopover();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
