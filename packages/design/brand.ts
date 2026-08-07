/**
 * What the brand kit contains.
 *
 * One list, read twice: `scripts/brand-assets.ts` generates from it, and the
 * /brand page builds its gallery and its ZIP link from it. A file the generator
 * does not write cannot appear on the page, and a file the page does not show
 * does not end up in the download.
 */

/** Where the files sit on the site. The generator decides where on disk. */
export const BRAND_BASE = "/brand";
export const KIT_FILENAME = "exeora-brand-kit.zip";

/** Pure black and white, for the listings that ask for exactly that. */
export const PURE_BLACK = "#000000";
export const PURE_WHITE = "#ffffff";

/**
 * What a preview of this variant has to sit on. `self` means the file paints
 * its own background and needs nothing behind it.
 */
export type BrandSurface = "dark" | "light" | "self";

export interface BrandVariant {
  id: string;
  label: string;
  /** One line on the page, saying where this file is the right one. */
  note: string;
  surface: BrandSurface;
  /** Basename of the vector, or null where the variant is raster-only. */
  svg: string | null;
  pngSizes: readonly number[];
  /** Basename pattern for the raster, with the size substituted. */
  png: (size: number) => string;
}

export interface BrandGroup {
  id: string;
  title: string;
  blurb: string;
  variants: readonly BrandVariant[];
}

const markPng = (suffix: string) => (size: number) => `exeora-mark-${size}-${suffix}.png`;
const wordmarkPng = (suffix: string) => (width: number) => `exeora-wordmark-${width}-${suffix}.png`;

const MARK_SIZES = [256, 512, 1024] as const;
const WORDMARK_WIDTHS = [512, 1024] as const;

export const BRAND_GROUPS: readonly BrandGroup[] = [
  {
    id: "mark",
    title: "The mark",
    blurb:
      "Three tiles: a client, the gateway, and the machine that does the work, meeting at the corners rather than merging. Use it alone where the name is already on screen, or where the space is square.",
    variants: [
      {
        id: "mark-light",
        label: "Light, transparent",
        note: "The default. For dark backgrounds.",
        surface: "dark",
        svg: "exeora-mark-light.svg",
        pngSizes: MARK_SIZES,
        png: markPng("light"),
      },
      {
        id: "mark-dark",
        label: "Dark, transparent",
        note: "For light backgrounds and print.",
        surface: "light",
        svg: "exeora-mark-dark.svg",
        pngSizes: MARK_SIZES,
        png: markPng("dark"),
      },
      {
        id: "mark-on-brand",
        label: "On the brand square",
        note: "The app icon: rounded, on #0d0f11. What an avatar slot wants.",
        surface: "self",
        svg: "exeora-mark-on-brand.svg",
        pngSizes: MARK_SIZES,
        png: markPng("on-brand"),
      },
      {
        id: "mark-on-black",
        label: "On pure black",
        note: "Full bleed, #ffffff on #000000, for listings that ask for exactly that.",
        surface: "self",
        svg: "exeora-mark-on-black.svg",
        pngSizes: MARK_SIZES,
        png: markPng("on-black"),
      },
    ],
  },
  {
    id: "wordmark",
    title: "The wordmark",
    blurb:
      "The mark and the name, locked up. The name is Inter at weight 600, drawn as outlines, so the vector renders the same anywhere. Do not rebuild this lockup by setting the name yourself.",
    variants: [
      {
        id: "wordmark-light",
        label: "Light, transparent",
        note: "The default. For dark backgrounds.",
        surface: "dark",
        svg: "exeora-wordmark-light.svg",
        pngSizes: WORDMARK_WIDTHS,
        png: wordmarkPng("light"),
      },
      {
        id: "wordmark-dark",
        label: "Dark, transparent",
        note: "For light backgrounds and print.",
        surface: "light",
        svg: "exeora-wordmark-dark.svg",
        pngSizes: WORDMARK_WIDTHS,
        png: wordmarkPng("dark"),
      },
    ],
  },
] as const;

/**
 * The two files that carry `currentColor` instead of a baked colour. Not in the
 * gallery, because there is nothing to preview: they take the colour of
 * whatever embeds them.
 */
export const BRAND_INHERIT_FILES = ["exeora-mark.svg", "exeora-wordmark.svg"] as const;

/** Every basename in the kit, in the order the ZIP should list them. */
export function brandFiles(): string[] {
  const files: string[] = [...BRAND_INHERIT_FILES];
  for (const group of BRAND_GROUPS) {
    for (const variant of group.variants) {
      if (variant.svg) files.push(variant.svg);
      for (const size of variant.pngSizes) files.push(variant.png(size));
    }
  }
  return files;
}
