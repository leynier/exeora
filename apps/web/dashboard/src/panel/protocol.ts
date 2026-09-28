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

/** Panel to shell. */
export interface PanelMessage {
  exeora: "panel";
  id: number;
  request: PanelRequest;
}

/** Shell to panel, answering the message with the same id. */
export type ShellMessage =
  | { exeora: "shell"; id: number; ok: true; result: PanelResults[PanelRequest["kind"]] }
  | { exeora: "shell"; id: number; ok: false; error: string };

/** Where the panel is served, relative to the gateway's origin. */
export const PANEL_PATH = "/dashboard/panel";

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
