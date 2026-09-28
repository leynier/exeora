import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type BottomBarItem<Id extends string = string> = {
  id: Id;
  label: string;
  /** What fits under the icon when the label does not: "Git" for Source Control. */
  short?: string;
  icon: LucideIcon;
  /** A small mark on the icon: a count of changes, a dot for attention. */
  badge?: ReactNode;
  disabled?: boolean;
};

/**
 * The navigation of a narrow screen: a row of icons with short labels along
 * the bottom edge, where a thumb rests.
 *
 * It is a `nav` of buttons rather than tabs, because each one is a place the
 * whole screen goes to, and the current one is marked with `aria-current`.
 */
export function BottomBar<Id extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
}: {
  items: readonly BottomBarItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`border-border-subtle bg-surface flex shrink-0 items-stretch border-t pb-[env(safe-area-inset-bottom)] ${className}`}
    >
      {items.map((item) => {
        const current = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={current ? "page" : undefined}
            aria-label={item.label}
            disabled={item.disabled}
            className={`duration-fast relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 transition-colors disabled:opacity-40 ${
              current ? "text-foreground" : "text-foreground-faint hover:text-foreground-muted"
            }`}
            onClick={() => onChange(item.id)}
          >
            <span className="relative">
              <Icon aria-hidden="true" className="size-5" />
              {item.badge !== undefined && item.badge !== null ? (
                <span className="text-label-md bg-brand text-on-accent absolute -top-1.5 -right-2.5 min-w-4 rounded-full px-1 text-center font-mono leading-4 tabular-nums">
                  {item.badge}
                </span>
              ) : null}
            </span>
            <span className="text-label-md w-full truncate text-center font-sans normal-case tracking-normal">
              {item.short ?? item.label}
            </span>
            {current ? (
              <span
                aria-hidden="true"
                className="bg-brand absolute inset-x-3 top-0 h-0.5 rounded-b"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
