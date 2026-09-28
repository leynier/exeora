import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { Side } from "./position.js";
import { Tooltip } from "./Tooltip.js";
import { iconButtonClass, iconClass } from "./tokens.js";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** What the button does, read by screen readers and shown on hover. */
  label: string;
  icon: LucideIcon;
  size?: keyof typeof iconButtonClass.size;
  variant?: keyof typeof iconButtonClass.variant;
  /** For a toggle: whether it is on. Sets `aria-pressed` and the pressed look. */
  pressed?: boolean;
  /** A count or letter drawn after the icon, such as the number of commits to push. */
  badge?: ReactNode;
  tooltipSide?: Side;
  /** Spins the icon, for a refresh that is running. */
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/**
 * A button that is its icon.
 *
 * The label is mandatory: an icon alone is a guess, and a toolbar of guesses
 * is what this replaces. It is read out, shown as a tooltip and, when there is
 * a badge, drawn next to the icon.
 */
export function IconButton({
  label,
  icon: Icon,
  size = "md",
  variant = "ghost",
  pressed,
  badge,
  tooltipSide,
  busy = false,
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip label={label} side={tooltipSide ?? "bottom"}>
      <button
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={`${iconButtonClass.base} ${badge !== undefined && badge !== null ? "gap-1 px-2" : ""} ${
          iconButtonClass.size[size]
        } ${badge !== undefined && badge !== null ? "w-auto" : ""} ${
          pressed ? iconButtonClass.pressed : iconButtonClass.variant[variant]
        } ${className}`}
        {...rest}
      >
        <Icon aria-hidden="true" className={`${iconClass[size]} ${busy ? "animate-spin" : ""}`} />
        {badge !== undefined && badge !== null ? (
          <span className="text-label-md font-mono tabular-nums">{badge}</span>
        ) : null}
      </button>
    </Tooltip>
  );
}
