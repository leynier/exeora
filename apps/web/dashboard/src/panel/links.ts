/**
 * Where a link in the panel opens.
 *
 * `panel.html` sends every link without a `target` of its own to a tab, so a
 * README or a pull request cannot navigate the frame away. A link to a place
 * on this same page (a README's table of contents) is the exception: it
 * scrolls, and opening it in a tab would show the panel's page unframed.
 */

/** Whether `href` only moves within the document at `here`. */
export function isInPageLink(href: string, here: string): boolean {
  let target: URL;
  let current: URL;
  try {
    target = new URL(href, here);
    current = new URL(here);
  } catch {
    return false;
  }
  return (
    target.hash !== "" &&
    target.origin === current.origin &&
    target.pathname === current.pathname &&
    target.search === current.search
  );
}

/** Keeps in-page links in the frame, before the browser follows them. */
export function keepInPageLinksHere(doc: Document): void {
  doc.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("target")) return;
      if (isInPageLink(anchor.href, doc.location.href)) anchor.target = "_self";
    },
    // Before React's handlers and the browser's default action.
    { capture: true },
  );
}
