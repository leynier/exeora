/**
 * Class strings the primitives share, so a menu item in a context menu and one
 * in a split button are the same item.
 */

export const menuPanelClass =
  "popover-panel border-border bg-surface-elevated fixed inset-auto m-0 min-w-44 rounded-lg border p-1 shadow-xl shadow-black/40";

export const menuItemClass =
  "text-body-md duration-fast flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50";

export const menuItemToneClass = {
  plain:
    "text-foreground-muted hover:bg-surface-variant hover:text-foreground focus-visible:bg-surface-variant focus-visible:text-foreground",
  danger: "text-error hover:bg-error/10 focus-visible:bg-error/10",
} as const;

export const iconButtonClass = {
  base: "duration-fast inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50",
  size: { sm: "size-7", md: "size-8", lg: "size-9" },
  variant: {
    ghost: "text-foreground-muted hover:bg-surface-variant hover:text-foreground",
    outline:
      "border border-border text-foreground-muted hover:bg-surface-variant hover:text-foreground",
    primary: "bg-accent text-on-accent hover:bg-foreground",
    danger: "text-error hover:bg-error/10",
  },
  pressed: "bg-accent-subtle text-foreground",
} as const;

export const iconClass = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const;
