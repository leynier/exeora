/**
 * What the side panel page and the Chrome extension around it say to each
 * other.
 *
 * The extension is a thin shell: it signs in with `chrome.identity`, keeps the
 * tokens, and frames `/dashboard/panel` from the gateway. Everything the panel
 * shows is served here, so a deploy of the gateway updates it without a new
 * version in the Chrome Web Store. What only the extension can do, the panel
 * asks for over `postMessage`.
 *
 * The conversation runs over a `MessageChannel` the panel's document opens
 * once, handing one port to the shell in a `connect` message, the only one
 * sent through the window. A link that takes the frame somewhere else takes
 * the port with it: the panel says `bye` on its way out (Chrome does not fire
 * the port's `close` for a navigation), the shell stops answering and loads
 * the panel again. So a document that is not this panel never gets a token, even
 * one on the gateway's own origin.
 *
 * The two ship separately: the gateway on every push to main, the extension
 * when a tag says so. So a change here stays compatible with every shell
 * already installed. A new request is added rather than an old one changed,
 * and `PANEL_PROTOCOL` goes up when the panel needs a shell that knows it.
 */

/** The version this side speaks. A shell reports its own in answer to `ready`. */
export const PANEL_PROTOCOL = 1;

export type PanelRequest =
  /** The first message. Answered once the shell is listening. */
  | { kind: "ready" }
  /** A usable access token, refreshed first when `force`; null once signed out. */
  | { kind: "token"; force?: boolean }
  /** A dashboard path (starting with `/`) opened in a tab of its own. */
  | { kind: "open"; path: string }
  /** Ends the session. The shell replaces the panel with its sign-in screen. */
  | { kind: "signOut" };

export interface PanelResults {
  ready: { protocol: number };
  token: { token: string | null };
  open: Record<string, never>;
  signOut: Record<string, never>;
}

/** Panel to shell, through the window, carrying the port everything else uses. */
export interface ConnectMessage {
  exeora: "panel";
  kind: "connect";
}

/** Panel to shell, over the port, as its document goes away. */
export interface ByeMessage {
  exeora: "panel";
  kind: "bye";
}

/** Panel to shell, over the port. */
export interface PanelMessage {
  exeora: "panel";
  id: number;
  request: PanelRequest;
}

/** Shell to panel, over the port, answering the message with the same id. */
export type ShellMessage =
  | { exeora: "shell"; id: number; ok: true; result: PanelResults[PanelRequest["kind"]] }
  | { exeora: "shell"; id: number; ok: false; error: string };

/** Where the panel is served, relative to the gateway's origin. */
export const PANEL_PATH = "/dashboard/panel";

export function isConnectMessage(data: unknown): data is ConnectMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Partial<ConnectMessage>;
  return message.exeora === "panel" && message.kind === "connect";
}

export function isByeMessage(data: unknown): data is ByeMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Partial<ByeMessage>;
  return message.exeora === "panel" && message.kind === "bye";
}

export function isPanelMessage(data: unknown): data is PanelMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Partial<PanelMessage>;
  return (
    message.exeora === "panel" &&
    typeof message.id === "number" &&
    typeof message.request === "object" &&
    message.request !== null &&
    typeof message.request.kind === "string"
  );
}

export function isShellMessage(data: unknown): data is ShellMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Partial<ShellMessage>;
  return message.exeora === "shell" && typeof message.id === "number";
}
