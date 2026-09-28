/**
 * Where a floating panel goes, given what it hangs from.
 *
 * Pure geometry, so the tooltip, the menus and the context menu agree on how
 * they flip and slide to stay on screen, and so the rules can be tested
 * without a browser. Everything is in viewport pixels.
 */

export type Rect = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export type Placement = { top: number; left: number; side: Side };

const EDGE = 8;

/**
 * Hangs `panel` off `anchor` on `side`, flipping to the opposite side when it
 * would not fit and there is more room there, then slides it along the other
 * axis so it stays `EDGE` pixels inside the viewport.
 */
export function placeAnchored(
  anchor: Rect,
  panel: Size,
  viewport: Size,
  options: { side?: Side; align?: Align; gap?: number } = {},
): Placement {
  const { side: wanted = "bottom", align = "start", gap = 6 } = options;
  const side = flipped(anchor, panel, viewport, wanted, gap);
  let top: number;
  let left: number;

  if (side === "top" || side === "bottom") {
    top = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - panel.height - gap;
    left = along(anchor.left, anchor.width, panel.width, align);
  } else {
    left = side === "right" ? anchor.left + anchor.width + gap : anchor.left - panel.width - gap;
    top = along(anchor.top, anchor.height, panel.height, align);
  }

  return {
    top: clamp(top, EDGE, Math.max(EDGE, viewport.height - panel.height - EDGE)),
    left: clamp(left, EDGE, Math.max(EDGE, viewport.width - panel.width - EDGE)),
    side,
  };
}

/** A panel opened at a point, such as a context menu: down and right of it, flipping to fit. */
export function placeAtPoint(
  point: { x: number; y: number },
  panel: Size,
  viewport: Size,
): Placement {
  return placeAnchored({ top: point.y, left: point.x, width: 0, height: 0 }, panel, viewport, {
    side: "bottom",
    align: "start",
    gap: 2,
  });
}

function flipped(anchor: Rect, panel: Size, viewport: Size, side: Side, gap: number): Side {
  const room = {
    top: anchor.top - gap,
    bottom: viewport.height - (anchor.top + anchor.height) - gap,
    left: anchor.left - gap,
    right: viewport.width - (anchor.left + anchor.width) - gap,
  };
  const needed = side === "top" || side === "bottom" ? panel.height : panel.width;
  if (room[side] >= needed) return side;
  const opposite = OPPOSITE[side];
  return room[opposite] > room[side] ? opposite : side;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function along(start: number, length: number, size: number, align: Align): number {
  if (align === "start") return start;
  if (align === "end") return start + length - size;
  return start + (length - size) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
