import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import { MenuPanel } from "./MenuPanel.js";
import type { MenuEntry } from "./menu.js";
import { placeAtPoint } from "./position.js";

/** How long a finger rests before it counts as asking for the menu. */
const PRESS_DELAY_MS = 500;
/** A finger that moves this far is scrolling, not pressing. */
const PRESS_SLOP_PX = 8;

export type ContextMenuHandle = {
  /** Opens the menu at a point with these entries. */
  open: (at: { x: number; y: number }, label: string, entries: readonly MenuEntry[]) => void;
  /** The one panel; render it once, wherever. */
  panel: ReactNode;
  /** Handlers for an element whose right click or long press opens `entries`. */
  triggers: (
    label: string,
    entries: () => readonly MenuEntry[],
  ) => {
    onContextMenu: (event: {
      preventDefault: () => void;
      stopPropagation: () => void;
      clientX: number;
      clientY: number;
    }) => void;
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
  };
};

/**
 * One menu for many rows.
 *
 * A list gives each row a right click and a long press, but keeps a single
 * panel: the entries are worked out for the row that asked, when it asks.
 * The nearest handler answers and stops the event, so a menu wrapped around
 * the whole list only sees the empty space.
 */
export function useContextMenu(): ContextMenuHandle {
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const [state, setState] = useState<{
    label: string;
    entries: readonly MenuEntry[];
    style: CSSProperties;
  }>({
    label: "Actions",
    entries: [],
    style: {},
  });

  const open = useCallback(
    (at: { x: number; y: number }, label: string, entries: readonly MenuEntry[]) => {
      const menu = panel.current;
      if (!menu || entries.length === 0) return;
      setState({ label, entries, style: {} });
      // The entries are in the DOM on the next frame; the panel measures then.
      requestAnimationFrame(() => {
        const element = panel.current;
        if (!element) return;
        if (!element.matches(":popover-open")) element.showPopover();
        const placed = placeAtPoint(at, element.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        setState((current) => ({ ...current, style: { top: placed.top, left: placed.left } }));
        element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
      });
    },
    [],
  );

  const cancelPress = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);

  const triggers = useCallback(
    (label: string, entries: () => readonly MenuEntry[]) => ({
      onContextMenu: (event: {
        preventDefault: () => void;
        stopPropagation: () => void;
        clientX: number;
        clientY: number;
      }) => {
        event.preventDefault();
        event.stopPropagation();
        open({ x: event.clientX, y: event.clientY }, label, entries());
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType === "mouse" || event.button !== 0) return;
        event.stopPropagation();
        cancelPress();
        const at = { x: event.clientX, y: event.clientY };
        press.current = {
          ...at,
          timer: window.setTimeout(() => {
            press.current = null;
            open(at, label, entries());
          }, PRESS_DELAY_MS),
        };
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const started = press.current;
        if (!started) return;
        if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > PRESS_SLOP_PX) {
          cancelPress();
        }
      },
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      onPointerLeave: cancelPress,
    }),
    [open, cancelPress],
  );

  const node = (
    <MenuPanel
      ref={panel}
      id={panelId}
      label={state.label}
      entries={state.entries}
      style={state.style}
      onClose={() => panel.current?.hidePopover()}
    />
  );

  return { open, panel: node, triggers };
}

/**
 * The menu of one thing: a right click, or a long press where there is no
 * right button, on whatever is inside.
 *
 * The wrapper is `display: contents`, so it adds nothing to the layout; the
 * gestures bubble up from the children. For a list of rows, `useContextMenu`
 * gives every row the same treatment with one panel.
 */
export function ContextMenu({
  label,
  entries,
  children,
  disabled = false,
}: {
  label: string;
  entries: readonly MenuEntry[];
  children: ReactNode;
  disabled?: boolean;
}) {
  const menu = useContextMenu();
  const triggers = menu.triggers(label, () => entries);
  return (
    // Not a control of its own: it listens for the gestures that bubble up
    // from the rows inside, and adds nothing to the layout or the tree.
    // biome-ignore lint/a11y/noStaticElementInteractions: a listener for its children's gestures
    <div
      className="contents"
      onContextMenu={disabled ? undefined : triggers.onContextMenu}
      onPointerDown={disabled ? undefined : triggers.onPointerDown}
      onPointerMove={triggers.onPointerMove}
      onPointerUp={triggers.onPointerUp}
      onPointerCancel={triggers.onPointerCancel}
      onPointerLeave={triggers.onPointerLeave}
    >
      {children}
      {menu.panel}
    </div>
  );
}
