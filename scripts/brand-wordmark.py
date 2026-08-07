"""Redraw packages/design/wordmark.svg, with the name as outlines.

One-off tooling, not part of any build. Run it only when the name, the face or
the lockup's proportions change; the SVG it writes is the committed source that
`scripts/brand-assets.ts` recolours and rasterises.

    uvx --with 'fonttools[woff]' --with uharfbuzz --from fonttools \
      python scripts/brand-wordmark.py

Python rather than TypeScript because the two things this needs - decompressing
a woff2 and walking glyph outlines - are fontTools, and there is no reason to
carry a second font stack in the repo for something that runs twice a decade.
"""

import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONT = Path("apps/web/landing/public/fonts/inter-latin.woff2")
OUT = Path("packages/design/wordmark.svg")

WORD = "Exeora"
WEIGHT = 600

# The mark's own space, and the site header's proportions: the mark is as tall
# as the font size, the gap is the header's 10/16 of it, and the tracking is
# `tracking-tight`, -0.025em. Keep these in step with Wordmark.astro.
MARK_W, MARK_H = 64.0, 44.0
EM = MARK_H
GAP = MARK_H * 10 / 16
TRACKING = -0.025 * EM

font_file = TTFont(FONT)
instancer.instantiateVariableFont(font_file, {"wght": WEIGHT}, inplace=True, updateFontNames=False)

# HarfBuzz wants a plain TTF, so drop the woff2 wrapper on the way through.
buffer = io.BytesIO()
font_file.flavor = None
font_file.save(buffer)

upem = font_file["head"].unitsPerEm
cap_height = font_file["OS/2"].sCapHeight
scale = EM / upem

# Shape rather than lay out by hand, so the kerning is the font's own.
shaper = hb.Font(hb.Face(buffer.getvalue()))
shaper.scale = (upem, upem)
text = hb.Buffer()
text.add_str(WORD)
text.guess_segment_properties()
hb.shape(shaper, text, {"kern": True, "liga": True})

glyph_order = font_file.getGlyphOrder()
glyphs = font_file.getGlyphSet()


def ink_bounds(name):
    """The glyph's drawn extent, which is not its advance."""
    pen = BoundsPen(glyphs)
    glyphs[name].draw(pen)
    return pen.bounds

# Centre the mark's full height on the cap-height block of the text.
baseline = MARK_H / 2 + cap_height * scale / 2

placed = []
pen_x = 0.0
for index, (info, position) in enumerate(zip(text.glyph_infos, text.glyph_positions)):
    placed.append(
        (
            glyph_order[info.codepoint],
            pen_x + position.x_offset * scale + index * TRACKING,
            baseline - position.y_offset * scale,
        )
    )
    pen_x += position.x_advance * scale

# Sit the text on its ink rather than its sidebearings, so the file has no slack
# around the letters and the gap is the gap that was asked for.
edges = [(x + b[0] * scale, x + b[2] * scale) for name, x, _ in placed if (b := ink_bounds(name))]
ink_left = min(left for left, _ in edges)
ink_right = max(right for _, right in edges)

shift = MARK_W + GAP - ink_left
width = round(ink_right + shift, 2)


def number(value: float) -> str:
    return f"{round(value, 2):g}"


def draw(name: str, x: float, y: float) -> str:
    """One glyph, flipped out of the font's y-up space and into the SVG's."""
    pen = SVGPathPen(glyphs, ntos=number)
    glyphs[name].draw(TransformPen(pen, Transform(scale, 0, 0, -scale, x + shift, y)))
    return pen.getCommands()


path = "".join(draw(name, x, y) for name, x, y in placed)


tiles = "\n".join(
    f'  <rect x="{tile[0]}" y="{tile[1]}" width="24" height="24" rx="4" />'
    for tile in ((20, 0), (0, 20), (40, 20))
)

OUT.write_text(f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {number(width)} {number(MARK_H)}" fill="currentColor">
  <title>Exeora</title>
  <!--
    The lockup: the mark, then the name, at the proportions the site header
    uses. The mark is as tall as the font size, the gap is 10/16 of that, and
    the tracking is -0.025em. The mark's full height is centred on the text's
    cap height.

    The name is Inter at weight {WEIGHT}, converted to outlines so the file renders
    the same on a machine that has never heard of Inter.

    Generated, not drawn: see scripts/brand-wordmark.py, which shapes the word
    with HarfBuzz so the kerning is the font's own. Re-run that if the face or
    the wording ever changes; do not nudge the numbers by hand.

    The tiles come from mark.ts and must stay in step with it.
  -->
{tiles}
  <path d="{path}" />
</svg>
""")

print(f"{OUT}: {width} x {MARK_H}, {len(path)} bytes of path data")
