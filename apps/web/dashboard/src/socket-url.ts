let gatewayOrigin: string | null = null;

/**
 * Names the gateway when the page is not served from it. The ChatGPT app runs
 * on a sandbox origin of its own, while its tickets still come from the
 * gateway; it sets the origin the gateway's resource was served with, never
 * one a ticket response names.
 */
export function configureTicketOrigin(origin: string | null): void {
  gatewayOrigin = origin;
}

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
  pageOrigin = gatewayOrigin ?? window.location.origin,
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
