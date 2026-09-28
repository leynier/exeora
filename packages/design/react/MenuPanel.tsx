import type { CSSProperties, FocusEvent, KeyboardEvent, Ref } from "react";
import { createPortal } from "react-dom";
import { isMenuAction, type MenuEntry, menuStep } from "./menu.js";
import { menuItemClass, menuItemToneClass, menuPanelClass } from "./tokens.js";

/**
 * The panel every menu shows: a `popover` with `role="menu"`, arrow keys
 * between the items, Escape and outside clicks from the platform.
 *
 * Placement is the caller's: a split button hangs it under the chevron, a
 * context menu puts it at the pointer. Both pass the style through.
 */
export function MenuPanel({
  id,
  label,
  entries,
  style,
  ref,
  onClose,
}: {
  id: string;
  label: string;
  entries: readonly MenuEntry[];
  style?: CSSProperties | undefined;
  ref: Ref<HTMLDivElement>;
  onClose: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    const from = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = menuStep(event.key, from, items.length);
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };

  // Tabbing out of the menu closes it; focus moving between its items must
  // not. React's onBlur is focusout, so it sees both.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) onClose();
  };

  // In the body rather than where it was declared: a row's text must not
  // carry its menu, and a form must not contain its buttons.
  return createPortal(
    <div
      ref={ref}
      id={id}
      popover="auto"
      role="menu"
      aria-label={label}
      style={style}
      className={menuPanelClass}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {entries.map((entry, index) => {
        if (!isMenuAction(entry)) {
          // Separators have no identity of their own; their place is it.
          // biome-ignore lint/suspicious/noArrayIndexKey: separators, not data
          return <hr key={`sep-${index}`} className="border-border-subtle my-1 border-t" />;
        }
        const Icon = entry.icon;
        return (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            title={entry.disabled ? entry.reason : undefined}
            className={`${menuItemClass} ${entry.danger ? menuItemToneClass.danger : menuItemToneClass.plain}`}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint ? (
              <span className="text-label-md text-foreground-faint shrink-0 font-mono">
                {entry.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
