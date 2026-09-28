import type { PointerEvent } from "react";
import { useRef } from "react";

/**
 * The edge of a panel that can be dragged to a new width.
 *
 * A separator in the accessibility tree, with its value range, so the arrow
 * keys work on it too: 16 pixels a step, 32 with Shift, Home and End for the
 * limits. The body's cursor is pinned for the duration of a drag so it does
 * not flicker as the pointer outruns the handle.
 */
export function ResizeHandle({
  value,
  min,
  max,
  onChange,
  onResizingChange,
  label,
  edge = "right",
  className = "",
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onResizingChange?: (resizing: boolean) => void;
  label: string;
  /** Which edge of its panel the handle sits on: dragging away from it widens. */
  edge?: "left" | "right";
  className?: string;
}) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));

  const release = () => {
    drag.current = null;
    onResizingChange?.(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  const finish = (event: PointerEvent<HTMLHRElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    release();
  };

  return (
    <hr
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className={`hover:bg-foreground-faint/30 active:bg-foreground-faint/50 absolute inset-y-0 m-0 h-auto w-2 cursor-col-resize touch-none border-0 ${
        edge === "right" ? "right-0" : "left-0"
      } ${className}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizingChange?.(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        const origin = drag.current;
        if (!origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = event.clientX - origin.x;
        onChange(clamp(origin.value + (edge === "right" ? delta : -delta)));
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 16;
        const grow = edge === "right" ? "ArrowRight" : "ArrowLeft";
        const shrink = edge === "right" ? "ArrowLeft" : "ArrowRight";
        if (event.key === grow) onChange(clamp(value + step));
        else if (event.key === shrink) onChange(clamp(value - step));
        else if (event.key === "Home") onChange(min);
        else if (event.key === "End") onChange(max);
        else return;
        event.preventDefault();
      }}
    />
  );
}
