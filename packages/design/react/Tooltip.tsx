import {
  type CSSProperties,
  cloneElement,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { placeAnchored, type Side } from "./position.js";

/** Hover waits so a pointer crossing a toolbar does not light every label up. */
const HOVER_DELAY_MS = 400;
/** A finger held on a control, which is how touch asks what a button does. */
const PRESS_DELAY_MS = 500;

type Handlers = {
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
};

/**
 * A label that appears when a control is hovered, focused or held.
 *
 * The child must be a single element that takes the pointer and focus
 * handlers, which is any button or link. The panel lives in the top layer
 * through `popover`, so it is never clipped by a scrolling list, and it is
 * wired with `aria-describedby` so the label reaches a screen reader whether
 * or not the panel is ever shown. Escape hides it, as does moving the
 * pointer away, blurring, or scrolling anything.
 */
export function Tooltip({
  label,
  side = "bottom",
  children,
}: {
  label: string;
  side?: Side;
  children: ReactElement<Handlers>;
}) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hide = useCallback(() => {
    clear();
    setStyle(null);
    const element = panel.current;
    if (element?.matches(":popover-open")) element.hidePopover();
  }, [clear]);

  const show = useCallback(() => {
    clear();
    const target = anchor.current;
    const element = panel.current;
    if (!target || !element) return;
    if (!element.matches(":popover-open")) element.showPopover();
    const placed = placeAnchored(
      target.getBoundingClientRect(),
      element.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { side, align: "center", gap: 6 },
    );
    setStyle({ top: placed.top, left: placed.left });
  }, [side, clear]);

  const later = (delay: number) => {
    clear();
    timer.current = window.setTimeout(show, delay);
  };

  useEffect(() => {
    if (!style) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [style, hide]);

  useEffect(() => clear, [clear]);

  const child = children.props;
  const control = cloneElement(children, {
    "aria-describedby": [child["aria-describedby"], id].filter(Boolean).join(" "),
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      child.onPointerEnter?.(event);
      anchor.current = event.currentTarget;
      if (event.pointerType === "mouse") later(HOVER_DELAY_MS);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      child.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      child.onPointerDown?.(event);
      anchor.current = event.currentTarget;
      if (event.pointerType === "mouse") hide();
      else later(PRESS_DELAY_MS);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      child.onPointerUp?.(event);
      if (event.pointerType !== "mouse") clear();
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      child.onPointerCancel?.(event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      child.onFocus?.(event);
      anchor.current = event.currentTarget;
      // Only keyboard focus asks for the label: a click focuses too, and the
      // pointer is already on the thing it names.
      if (event.currentTarget.matches(":focus-visible")) show();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      child.onBlur?.(event);
      hide();
    },
  });

  return (
    <>
      {control}
      {createPortal(
        <div
          ref={panel}
          id={id}
          role="tooltip"
          popover="manual"
          style={style ?? undefined}
          className={`text-label-md border-border bg-surface-elevated text-foreground pointer-events-none fixed inset-auto m-0 max-w-64 rounded-md border px-2 py-1 font-sans normal-case tracking-normal shadow-lg shadow-black/40 motion-safe:transition-opacity motion-safe:duration-fast ${
            style ? "opacity-100" : "opacity-0"
          }`}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}
