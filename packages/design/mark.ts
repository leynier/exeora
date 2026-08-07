/**
 * The mark, written down once.
 *
 * Three tiles: one above, two below and apart. A client, the gateway, and the
 * machine that does the work, meeting at the corners rather than merging.
 *
 * The tiles are 24 wide on a pitch of 20, so they overlap by exactly the corner
 * radius and the silhouette closes at the two junctions instead of pinching to
 * a point. Those three numbers are the whole mark; everything else here just
 * arranges them.
 *
 * Consumers: the landing's `Wordmark.astro`, and `scripts/brand-assets.ts`,
 * which draws the favicon and every downloadable file from these values. The
 * gateway's OAuth screens (`apps/gateway/src/oauth/pages.ts`) still carry a
 * hand-written copy, because they build their HTML as a template string in a
 * Worker; moving them onto this module is a separate change.
 */

export const MARK_TILE = 24;
export const MARK_RADIUS = 4;
export const MARK_PITCH = 20;

/** Top-left corner of each tile, in the mark's own 64x44 space. */
export const MARK_TILES = [
  { x: MARK_PITCH, y: 0 },
  { x: 0, y: MARK_PITCH },
  { x: MARK_PITCH * 2, y: MARK_PITCH },
] as const;

export const MARK_WIDTH = 64;
export const MARK_HEIGHT = 44;
export const MARK_VIEWBOX = `0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`;

/** The three `<rect>` elements, one per line, indented by `indent`. */
export function markRects(indent = ""): string {
  return MARK_TILES.map(
    (tile) =>
      `${indent}<rect x="${tile.x}" y="${tile.y}" width="${MARK_TILE}" height="${MARK_TILE}" rx="${MARK_RADIUS}" />`,
  ).join("\n");
}

/** Share of the square's width the mark spans when it is padded into one. */
export const MARK_SQUARE_SCALE = 0.78;

/** The favicon's corner radius, in the square's own 64-wide space. */
export const MARK_SQUARE_RADIUS = 14;

export interface MarkSvgOptions {
  /** Tile colour. Defaults to `currentColor`, so the file inherits its context. */
  fill?: string;
  /**
   * Draw the mark on a square of this colour. Implies `square`. Left out, the
   * mark sits on transparency.
   */
  background?: string;
  /** Corner radius of that square, in its own 64-wide space. 0 is a full bleed. */
  backgroundRadius?: number;
  /**
   * Pad the mark into a 64x64 canvas rather than leaving it at its own 64x44.
   * What every icon slot wants, and what a favicon has to be.
   */
  square?: boolean;
  /** Emitted as `<title>`, which is what a screen reader reads out. */
  title?: string;
}

/**
 * A standalone SVG document for the mark.
 *
 * The default viewBox is the mark's own 64x44, tight to the tiles, and the
 * caller decides the padding. `square` pads it into the 64x64 an icon slot
 * expects, and `background` fills that square in.
 */
export function markSvg(options: MarkSvgOptions = {}): string {
  const {
    fill = "currentColor",
    background,
    backgroundRadius = MARK_SQUARE_RADIUS,
    square = background !== undefined,
    title,
  } = options;

  const titleTag = title ? `\n  <title>${title}</title>` : "";

  if (!square) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="${fill}">${titleTag}
${markRects("  ")}
</svg>
`;
  }

  // Centre the scaled mark in the square, on its own centre rather than an
  // optically nudged one: the tiles are symmetrical, so there is nothing to
  // correct for, and the numbers stay derivable.
  const scale = MARK_SQUARE_SCALE;
  const round = (value: number) => Number(value.toFixed(2));
  const x = round((MARK_WIDTH - MARK_WIDTH * scale) / 2);
  const y = round((MARK_WIDTH - MARK_HEIGHT * scale) / 2);

  const plate =
    background === undefined
      ? ""
      : `\n  <rect width="${MARK_WIDTH}" height="${MARK_WIDTH}" rx="${backgroundRadius}" fill="${background}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_WIDTH} ${MARK_WIDTH}">${titleTag}${plate}
  <g fill="${fill}" transform="translate(${x} ${y}) scale(${scale})">
${markRects("    ")}
  </g>
</svg>
`;
}
