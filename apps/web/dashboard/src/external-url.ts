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

/** Opens an integration URL after applying the same scheme check as anchors. */
export function openExternalUrl(value: string | null | undefined): void {
  const url = externalHttpsUrl(value);
  if (url) openUrl(url);
}
