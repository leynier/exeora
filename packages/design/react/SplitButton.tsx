import { ChevronDown } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from "react";
import { MenuPanel } from "./MenuPanel.js";
import type { MenuEntry } from "./menu.js";
import { placeAnchored } from "./position.js";

/**
 * One primary action and a chevron holding the rest.
 *
 * The primary segment is chosen by the caller from the state it can see, so
 * the button reads "Commit", "Push 2" or "Publish branch" as the moment asks,
 * and everything else is one click further under the same control rather
 * than spread along a toolbar.
 */
export function SplitButton({
  label,
  onClick,
  disabled = false,
  busy = false,
  entries,
  menuLabel,
  variant = "primary",
  className = "",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  entries: readonly MenuEntry[];
  /** Names the chevron: "More commit actions". */
  menuLabel: string;
  variant?: "primary" | "plain";
  className?: string;
}) {
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();

  const place = useCallback(() => {
    const button = trigger.current;
    const menu = panel.current;
    if (!button || !menu) return;
    const placed = placeAnchored(
      button.getBoundingClientRect(),
      menu.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { side: "bottom", align: "end" },
    );
    setStyle({ top: placed.top, left: placed.left });
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

  const tone =
    variant === "primary"
      ? "bg-accent text-on-accent hover:bg-foreground border-transparent"
      : "border-border text-foreground-muted hover:bg-surface-variant hover:text-foreground";

  return (
    <div className={`inline-flex min-w-0 items-stretch ${className}`}>
      <button
        type="button"
        disabled={disabled || busy}
        aria-busy={busy}
        className={`text-title-md duration-fast inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-l-lg border border-r-0 px-3 py-1.5 transition-colors disabled:pointer-events-none disabled:opacity-50 ${tone}`}
        onClick={onClick}
      >
        <span className="truncate">{label}</span>
      </button>
      <button
        ref={trigger}
        type="button"
        popoverTarget={panelId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        disabled={disabled || entries.length === 0}
        className={`duration-fast inline-flex w-8 shrink-0 items-center justify-center rounded-r-lg border transition-colors disabled:pointer-events-none disabled:opacity-50 ${tone} ${
          variant === "primary" ? "border-l-on-accent/20" : ""
        }`}
        onKeyDown={(event) => {
          if (open || event.key !== "ArrowDown") return;
          event.preventDefault();
          panel.current?.showPopover();
        }}
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      <MenuPanel
        ref={panel}
        id={panelId}
        label={menuLabel}
        entries={entries}
        style={style}
        onClose={() => panel.current?.hidePopover()}
      />
    </div>
  );
}
