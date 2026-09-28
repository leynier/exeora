import {
  type ByeMessage,
  type ConnectMessage,
  isShellMessage,
  type PanelMessage,
  type PanelRequest,
  type PanelResults,
} from "./protocol.js";

/**
 * The panel's end of the conversation with the extension that frames it.
 *
 * It opens a `MessageChannel` and hands one port to the shell; every request
 * then goes over the other and is answered with the same id, or times out.
 * The port is the whole of the trust: only the document that opened it can
 * ask anything, and the shell stops answering when that document goes away.
 */

export interface BridgeDeps {
  /**
   * Hands the shell its port, in a `connect` message to the window that
   * frames this page, at the origin it was framed by. Called once.
   */
  connect: (port: MessagePort) => void;
}

type Kind = PanelRequest["kind"];

/** Long enough for a refresh on a slow network; the rest answer at once. */
const TIMEOUTS: Record<Kind, number> = {
  ready: 5_000,
  token: 30_000,
  open: 5_000,
  signOut: 10_000,
};

export class BridgeError extends Error {}

export function createBridge(deps: BridgeDeps) {
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const channel = new MessageChannel();
  const port = channel.port1;
  port.onmessage = (event: MessageEvent) => {
    if (!isShellMessage(event.data)) return;
    const waiting = pending.get(event.data.id);
    if (!waiting) return;
    pending.delete(event.data.id);
    clearTimeout(waiting.timer);
    if (event.data.ok) waiting.resolve(event.data.result);
    else waiting.reject(new BridgeError(event.data.error));
  };
  deps.connect(channel.port2);

  return {
    request<K extends Kind>(request: Extract<PanelRequest, { kind: K }>): Promise<PanelResults[K]> {
      const id = nextId++;
      return new Promise<PanelResults[K]>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError("The Exeora extension did not answer."));
        }, TIMEOUTS[request.kind]);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        const message: PanelMessage = { exeora: "panel", id, request };
        port.postMessage(message);
      });
    },

    /** Tells the shell this document is going away, so it loads the panel again. */
    leave() {
      const bye: ByeMessage = { exeora: "panel", kind: "bye" };
      port.postMessage(bye);
    },

    close() {
      port.close();
      for (const [id, waiting] of pending) {
        clearTimeout(waiting.timer);
        waiting.reject(new BridgeError("The panel closed."));
        pending.delete(id);
      }
    },
  };
}

export type Bridge = ReturnType<typeof createBridge>;

/** What the panel posts to the window framing it, with the shell's port. */
export const CONNECT: ConnectMessage = { exeora: "panel", kind: "connect" };

/**
 * The extension this page is framed by, or null when it is not framed by one:
 * opened in a tab, say, where there is no shell to ask for a token.
 */
export function framingExtension(
  win: { parent: unknown; location: { ancestorOrigins?: ArrayLike<string> } } = window,
): string | null {
  if (win.parent === win) return null;
  const origin = win.location.ancestorOrigins?.[0];
  return origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : null;
}
