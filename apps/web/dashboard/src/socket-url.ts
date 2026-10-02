/**
 * Converts a gateway-issued HTTP ticket URL into a WebSocket URL.
 *
 * Ticket URLs contain a one-use credential. Keep that credential on the
 * origin that issued it, even if a bad response or a misconfigured gateway
 * returns another host. The dashboard is served over HTTP(S), so the socket
 * scheme follows the page scheme for local development and production.
 */
export function ticketSocketUrl(
  value: string,
  pageOrigin = window.location.origin,
): URL | undefined {
  try {
    const page = new URL(pageOrigin);
    const target = new URL(value);
    const pageScheme =
      page.protocol === "https:" ? "https:" : page.protocol === "http:" ? "http:" : null;
    if (!pageScheme || target.origin !== page.origin || target.protocol !== pageScheme) {
      return undefined;
    }
    target.protocol = pageScheme === "https:" ? "wss:" : "ws:";
    return target;
  } catch {
    return undefined;
  }
}
