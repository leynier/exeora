import { useCallback, useEffect, useId, useRef, useState } from "react";

export type SelectOption = { value: string; label: string };

/**
 * A dropdown we draw ourselves.
 *
 * A native `<select>` hands its menu to the operating system, which paints it
 * in its own colours, refuses a pointer cursor on most platforms and cannot
 * mark the current value with anything but a tick of its choosing. In a card
 * header full of our own type and borders that mismatch is the first thing you
 * see, so the menu is ours.
 *
 * What stays the platform's is `popover`: it lifts the menu into the top layer,
 * so it is not clipped by the card's `overflow-hidden`, and it brings Escape,
 * dismissal on a click anywhere else, and focus returning to the button. All
 * that leaves us is placement, which is the one thing the popover API cannot do
 * on its own without anchor positioning.
 */
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  /** Names the control for screen readers; the button itself shows the value. */
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}) {
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);

  /** Pins the menu under the button, flipping or sliding it to stay on screen. */
  const place = useCallback(() => {
    const button = trigger.current;
    const menu = panel.current;
    if (!button || !menu) return;

    const anchor = button.getBoundingClientRect();
    menu.style.minWidth = `${anchor.width}px`;

    const gap = 6;
    const menuRect = menu.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom;
    const flip = below < menuRect.height + gap && anchor.top > below;

    menu.style.top = `${flip ? anchor.top - menuRect.height - gap : anchor.bottom + gap}px`;
    menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - menuRect.width - 8))}px`;
  }, []);

  // The popover can also be closed by Escape or by a click elsewhere, so its
  // own `toggle` event is the only honest source for whether it is open.
  useEffect(() => {
    const menu = panel.current;
    if (!menu) return;

    const onToggle = (event: Event) => {
      const opening = (event as ToggleEvent).newState === "open";
      setOpen(opening);
      if (!opening) return;
      place();
      const option =
        menu.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
        menu.querySelector<HTMLButtonElement>('[role="option"]');
      option?.focus();
    };

    menu.addEventListener("toggle", onToggle);
    return () => menu.removeEventListener("toggle", onToggle);
  }, [place]);

  // Nothing tethers the menu to the button once it is in the top layer, so it
  // has to be told whenever the page moves underneath it.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={panelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`border-border text-body-md duration-fast flex items-center gap-1.5 rounded-lg border py-1.5 pr-2 pl-2.5 transition-colors ${
          open ? "bg-surface-variant text-foreground" : "bg-surface text-foreground-muted"
        } hover:bg-surface-variant hover:text-foreground`}
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          panel.current?.showPopover();
        }}
      >
        <span className="sr-only">{label}</span>
        {/* Capped, because a project is free to have a paragraph for a name. */}
        <span className="max-w-44 truncate">{selected?.label ?? ""}</span>
        <Chevron open={open} />
      </button>

      <div
        ref={panel}
        id={panelId}
        popover="auto"
        role="listbox"
        aria-label={label}
        className="popover-panel border-border bg-surface-elevated fixed inset-auto m-0 max-h-72 overflow-y-auto rounded-lg border p-1 shadow-xl shadow-black/40"
        onKeyDown={(event) => {
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
          ];
          const from = items.indexOf(document.activeElement as HTMLButtonElement);
          const step = { ArrowDown: from + 1, ArrowUp: from - 1, Home: 0, End: items.length - 1 }[
            event.key
          ];
          if (step === undefined) return;
          event.preventDefault();
          items[(step + items.length) % items.length]?.focus();
        }}
        // Tabbing out of the menu should close it, but focus moving between
        // options must not. React's onBlur is focusout, so it sees both.
        onBlur={(event) => {
          if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
            panel.current?.hidePopover();
          }
        }}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={active}
              // The focus ring is pulled inwards: arrowing through the list
              // moves focus, and at the default offset the ring would sit on
              // top of the panel's own border.
              className={`text-body-md duration-fast flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                active ? "text-foreground" : "text-foreground-muted"
              } hover:bg-surface-variant hover:text-foreground focus-visible:bg-surface-variant focus-visible:text-foreground focus-visible:-outline-offset-2`}
              onClick={() => {
                onChange(option.value);
                panel.current?.hidePopover();
              }}
            >
              <Check shown={active} />
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`duration-fast size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  );
}

/**
 * Always laid out, only sometimes drawn, so the labels line up either way.
 * Grayscale, not brand: that hue is spoken for by connection state.
 */
function Check({ shown }: { shown: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-3 shrink-0 ${shown ? "text-foreground" : "invisible"}`}
    >
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  );
}
