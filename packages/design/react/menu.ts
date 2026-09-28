import type { LucideIcon } from "lucide-react";

/**
 * One entry of a menu, whichever primitive shows it.
 *
 * A separator groups what is around it; the rest are actions. `hint` is a
 * small note at the right edge, such as a keyboard shortcut or a count.
 */
export type MenuEntry =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      onSelect: () => void;
      icon?: LucideIcon;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Why it is disabled, shown as a title so the reason is one hover away. */
      reason?: string;
    };

export type MenuAction = Exclude<MenuEntry, { separator: true }>;

export function isMenuAction(entry: MenuEntry): entry is MenuAction {
  return entry.separator !== true;
}

/** The step a menu key asks for over `count` items, or undefined for any other key. */
export function menuStep(key: string, from: number, count: number): number | undefined {
  if (count === 0) return undefined;
  const target = { ArrowDown: from + 1, ArrowUp: from - 1, Home: 0, End: count - 1 }[key];
  if (target === undefined) return undefined;
  return ((target % count) + count) % count;
}
