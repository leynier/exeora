import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useRef } from "react";

export type TabItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** A short mark after the label: a count, or a dot for unsaved changes. */
  badge?: ReactNode;
  closable?: boolean;
  /** Drawn in italics: a preview that the next single click replaces. */
  preview?: boolean;
  /** For a control the tab is not for, such as a file whose machine is offline. */
  disabled?: boolean;
  title?: string;
};

/**
 * A row of tabs, with the keyboard behaviour a tab list is expected to have:
 * one stop in the tab order, arrows to move between them, Home and End.
 *
 * `onClose` makes each closable tab carry an x, and a middle click closes it
 * the way editors do. `onPin` is for the preview convention: a double click
 * keeps a tab that a single click would have replaced.
 */
export function Tabs({
  tabs,
  value,
  onChange,
  onClose,
  onPin,
  label,
  size = "md",
  className = "",
}: {
  tabs: readonly TabItem[];
  value: string | null;
  onChange: (id: string) => void;
  onClose?: (id: string) => void;
  onPin?: (id: string) => void;
  /** Names the list: "Workspace views", "Open files". */
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []),
    ];
    const from = entries.indexOf(document.activeElement as HTMLButtonElement);
    const step = {
      ArrowRight: from + 1,
      ArrowLeft: from - 1,
      Home: 0,
      End: entries.length - 1,
    }[event.key];
    if (step === undefined || entries.length === 0) return;
    event.preventDefault();
    const next = entries[(step + entries.length) % entries.length];
    next?.focus();
    const id = next?.dataset.tab;
    if (id) onChange(id);
  };

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className={`flex min-w-0 items-stretch overflow-x-auto ${className}`}
      onKeyDown={move}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        const Icon = tab.icon;
        return (
          <div
            key={tab.id}
            className={`group relative flex shrink-0 items-center border-b-2 ${
              selected ? "border-brand" : "border-transparent"
            }`}
          >
            <button
              type="button"
              role="tab"
              data-tab={tab.id}
              id={`tab-${tab.id}`}
              aria-selected={selected}
              tabIndex={selected || (value === null && tab === tabs[0]) ? 0 : -1}
              disabled={tab.disabled}
              title={tab.title}
              className={`duration-fast flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                size === "sm" ? "text-body-md px-2.5 py-1.5" : "text-title-md px-3 py-2"
              } ${onClose && tab.closable ? "pr-1" : ""} ${
                selected ? "text-foreground" : "text-foreground-faint hover:text-foreground-muted"
              } ${tab.preview ? "italic" : ""}`}
              onClick={() => onChange(tab.id)}
              onDoubleClick={() => onPin?.(tab.id)}
              onAuxClick={(event: MouseEvent) => {
                if (event.button === 1 && onClose && tab.closable) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
              <span className="max-w-48 truncate">{tab.label}</span>
              {tab.badge !== undefined && tab.badge !== null ? (
                <span className="text-label-md font-mono tabular-nums">{tab.badge}</span>
              ) : null}
            </button>
            {onClose && tab.closable ? (
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                tabIndex={-1}
                className="text-foreground-faint hover:bg-surface-variant hover:text-foreground mr-1 inline-flex size-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
