/**
 * Turns a URL supplied by a remote integration into a link the browser may
 * open. API data can contain a malformed or active URL, so navigation targets
 * stay absolute HTTPS addresses; values with other schemes are omitted.
 */
export function externalHttpsUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

let openUrl: (url: string) => void = (url) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

/** Where external URLs open. A host that frames the screens may not allow popups. */
export function configureExternalOpener(open: (url: string) => void): void {
  openUrl = open;
}

let leaveFor: ((url: string) => void) | null = null;

/**
 * Where a page that would send the browser away (to GitHub, to connect it)
 * sends it instead. A host frame cannot be navigated away from: it opens the
 * address outside and stays, and the page says so.
 */
export function configureLeave(open: (url: string) => void): void {
  leaveFor = open;
}

/**
 * Sends the browser to an integration URL. Says whether this page stays,
 * because the address opened somewhere else.
 */
export function leaveForExternalUrl(value: string): "left" | "opened" | "refused" {
  const url = externalHttpsUrl(value);
  if (!url) return "refused";
  if (leaveFor) {
    leaveFor(url);
    return "opened";
  }
  window.location.assign(url);
  return "left";
}

/** Opens an integration URL after applying the same scheme check as anchors. */
export function openExternalUrl(value: string | null | undefined): void {
  const url = externalHttpsUrl(value);
  if (url) openUrl(url);
}
