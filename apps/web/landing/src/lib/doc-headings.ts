/**
 * The outline of a documentation page, taken from its rendered HTML.
 *
 * The pages are hand-written Astro, not Markdown, so there is no heading list
 * handed over by a content pipeline. Rather than ask every page to repeat its
 * headings in a table of contents that could drift from them, the layout reads
 * them back out of what the page rendered.
 *
 * Headings that already carry an id keep it, since other pages link to those
 * anchors. The rest get one from their text, so every section can be linked to,
 * listed under "On this page", and returned by search as its own result.
 */

export interface DocHeading {
  id: string;
  depth: 2 | 3;
  /** Plain text, for labels and matching. */
  text: string;
  /** Inner markup with any `<code>` kept, for display. */
  html: string;
}

const HEADING = /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/gi;
const ID_ATTRIBUTE = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/**
 * The text of a heading's markup, for slugs and labels; never inserted as HTML.
 *
 * Tags are stripped until none are left, since one pass over `<<b>b>` leaves a
 * `<b>` behind.
 */
export function headingText(html: string): string {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);

  return text
    .replace(/[<>]/g, "")
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function anchor(id: string): string {
  return `<a class="heading-anchor" href="#${id}" aria-label="Link to this section" data-pagefind-ignore>#</a>`;
}

/** Gives every h2/h3 an id and a link to itself, and returns the outline. */
export function outlineHtml(source: string): { html: string; headings: DocHeading[] } {
  const taken = new Set<string>();
  for (const match of source.matchAll(HEADING)) {
    const existing = ID_ATTRIBUTE.exec(match[2] ?? "");
    const id = existing?.[1] ?? existing?.[2];
    if (id) taken.add(id);
  }

  const headings: DocHeading[] = [];
  const html = source.replace(
    HEADING,
    (_match, level: string, attributes: string = "", inner: string) => {
      const existing = ID_ATTRIBUTE.exec(attributes);
      let id = existing?.[1] ?? existing?.[2];

      if (!id) {
        const base = slugify(headingText(inner));
        id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        taken.add(id);
        attributes = ` id="${id}"${attributes}`;
      }

      headings.push({
        id,
        depth: level === "2" ? 2 : 3,
        text: headingText(inner),
        html: inner.trim(),
      });

      return `<h${level}${attributes}>${inner}${anchor(id)}</h${level}>`;
    },
  );

  return { html, headings };
}
