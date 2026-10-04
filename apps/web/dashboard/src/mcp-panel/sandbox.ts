import { externalHttpsUrl } from "../external-url.js";

/**
 * What the ChatGPT sandbox takes away from a page that the dashboard's
 * screens assume, put back.
 */

/**
 * Web storage. A sandboxed frame without its own origin throws on the first
 * touch of `localStorage` or `sessionStorage`, and the Workspace keeps its
 * tabs and preferences there. In memory they last as long as the panel does.
 */
export function ensureStorage(win: Window & typeof globalThis): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = win[name];
      const probe = "exeora.probe";
      store.setItem(probe, "1");
      store.removeItem(probe);
    } catch {
      Object.defineProperty(win, name, { value: memoryStorage(), configurable: true });
    }
  }
}

export function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(String(key)) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(String(key)),
    setItem: (key, value) => void items.set(String(key), String(value)),
  };
}

/**
 * Links. The host decides whether a URL opens, so every anchor the screens
 * render (a README, a pull request, a check) goes to it rather than to a
 * popup the sandbox may block. The router's own links have already handled
 * their click by the time it bubbles here. A link within the page (a README's
 * table of contents) scrolls by hand: the document's `<base>` names the
 * gateway, so following it would navigate the frame there.
 */
export function routeLinksToHost(doc: Document, open: (url: string) => void): void {
  doc.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      doc.getElementById(safeDecode(href.slice(1)))?.scrollIntoView();
      return;
    }
    const url = externalHttpsUrl(anchor.href);
    if (url) open(url);
  });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
