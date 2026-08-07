/**
 * What the brand page shows, beyond the files themselves.
 *
 * The assets come straight from `@exeora/design/brand`, so this only adds what
 * a page needs and a generator does not: which tokens are worth naming in
 * public, and what each one is for. The hex values are still read from
 * `tokens.css` at build time rather than repeated here.
 */

export interface Swatch {
  /** Token name, with its leading dashes, as it appears in tokens.css. */
  token: string;
  label: string;
  note: string;
}

export const CORE_SWATCHES: readonly Swatch[] = [
  { token: "--color-bg", label: "Background", note: "The page. Every asset's dark surface." },
  { token: "--color-foreground", label: "Foreground", note: "Body text, and the mark on dark." },
  {
    token: "--color-accent",
    label: "Accent",
    note: "Every primary action. Near-white on purpose.",
  },
  { token: "--color-brand", label: "Connection", note: "Live state only, never body text." },
] as const;

export const SURFACE_SWATCHES: readonly Swatch[] = [
  { token: "--color-surface", label: "Surface", note: "Cards and inset panels." },
  {
    token: "--color-surface-elevated",
    label: "Elevated",
    note: "Menus and anything above a card.",
  },
  { token: "--color-border", label: "Border", note: "Visible edges." },
  { token: "--color-border-subtle", label: "Border subtle", note: "Section dividers." },
  { token: "--color-foreground-muted", label: "Muted", note: "Secondary prose." },
  { token: "--color-foreground-faint", label: "Faint", note: "Captions and eyebrows." },
] as const;

export interface TypeSample {
  /** Token name for the size, which also carries weight and tracking. */
  token: string;
  label: string;
  /** Tailwind class that applies the token, so the sample is the real thing. */
  className: string;
}

export const TYPE_SCALE: readonly TypeSample[] = [
  { token: "--text-display", label: "Display", className: "text-display" },
  { token: "--text-headline-lg", label: "Headline large", className: "text-headline-lg" },
  { token: "--text-headline-md", label: "Headline medium", className: "text-headline-md" },
  { token: "--text-title-lg", label: "Title", className: "text-title-lg" },
  { token: "--text-body-lg", label: "Body", className: "text-body-lg" },
  { token: "--text-label-md", label: "Label", className: "text-label-md font-mono uppercase" },
] as const;

export const USAGE_DO: readonly string[] = [
  "Keep clear space of at least one tile's width around the mark.",
  "Use the light files on dark backgrounds and the dark files on light ones.",
  "Reach for the on-black or on-brand square when a slot needs a filled icon.",
  "Scale the SVG. It is the same shape at every size.",
  "Refer to the product as Exeora, capital E, one word.",
];

export const USAGE_DONT: readonly string[] = [
  "Do not recolour the mark, or fill it with a gradient or a photograph.",
  "Do not rotate, stretch, skew, outline or add a shadow to it.",
  "Do not box it in, or set it on a background that leaves it hard to read.",
  "Do not rebuild the wordmark by setting the name in another face or weight.",
  "Do not use the mark as your own icon, or in a way that implies endorsement.",
];
