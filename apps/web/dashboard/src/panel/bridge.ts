import {
  isShellMessage,
  type PanelMessage,
  type PanelRequest,
  type PanelResults,
} from "./protocol.js";

/**
 * The panel's end of the conversation with the extension that frames it.
 *
 * Every request is answered by the shell with the same id, or times out. Only
 * the frame's own parent is listened to, and only from the origin the page was
 * framed by, which the gateway's `frame-ancestors` already limits to the
 * extension ids it allows.
 */

export interface BridgeDeps {
  /** The window that frames this page. */
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  /** Its origin: `chrome-extension://<id>`. Replies from anywhere else are ignored. */
  parentOrigin: string;
  /** Subscribes to this window's messages; returns the unsubscribe. */
  listen: (
    handler: (event: Pick<MessageEvent, "data" | "origin" | "source">) => void,
  ) => () => void;
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

  const stop = deps.listen((event) => {
    if (event.origin !== deps.parentOrigin || event.source !== deps.parent) return;
    if (!isShellMessage(event.data)) return;
    const waiting = pending.get(event.data.id);
    if (!waiting) return;
    pending.delete(event.data.id);
    clearTimeout(waiting.timer);
    if (event.data.ok) waiting.resolve(event.data.result);
    else waiting.reject(new BridgeError(event.data.error));
  });

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
        deps.parent.postMessage(message, deps.parentOrigin);
      });
    },

    close() {
      stop();
      for (const [id, waiting] of pending) {
        clearTimeout(waiting.timer);
        waiting.reject(new BridgeError("The panel closed."));
        pending.delete(id);
      }
    },
  };
}

export type Bridge = ReturnType<typeof createBridge>;

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
