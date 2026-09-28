import {
  isByeMessage,
  isConnectMessage,
  isPanelMessage,
  PANEL_PROTOCOL,
  type PanelRequest,
  type PanelResults,
  type ShellMessage,
} from "../../web/dashboard/src/panel/protocol.js";

/**
 * The shell's end of the conversation with the panel it frames.
 *
 * One of these per load of the frame. It takes the first `connect` that comes
 * from that frame at the gateway's origin, and from then on answers only on
 * the port it carried: the answers include the access token, so they go to
 * the document that opened the port and to nothing else. When that document
 * goes away (something navigated the frame, say) it says `bye`, or the port
 * closes where the browser reports that, and `onDisconnect` is the shell's
 * cue to load the panel again.
 */

/** The part of a `MessagePort` the shell uses. */
export interface ShellPort {
  postMessage(message: unknown): void;
  addEventListener(type: "message" | "close", listener: (event: MessageEvent) => void): void;
  start(): void;
  close(): void;
}

export interface ShellDeps {
  /** The gateway's origin, which the panel is served from. */
  gateway: string;
  /** The panel's window, once the frame exists. */
  frame: () => unknown;
  token: (options: { force?: boolean }) => Promise<string | null>;
  openTab: (url: string) => void;
  signOut: () => Promise<void>;
  /** Called when the panel says it is up, so the shell can stop showing its own loading state. */
  onReady: () => void;
  /** Called once, when the panel's document is gone. */
  onDisconnect: () => void;
}

type Result = PanelResults[PanelRequest["kind"]];

export function createShell(deps: ShellDeps) {
  const origin = new URL(deps.gateway).origin;
  let port: ShellPort | null = null;
  let disposed = false;

  async function answer(request: PanelRequest): Promise<Result> {
    switch (request.kind) {
      case "ready":
        deps.onReady();
        return { protocol: PANEL_PROTOCOL };
      case "token":
        return { token: await deps.token({ force: request.force === true }) };
      case "open": {
        // A path in the dashboard, never an address of the panel's choosing:
        // `/../oauth/authorize` resolves outside it, so the result is checked.
        if (typeof request.path !== "string" || !request.path.startsWith("/")) {
          throw new Error("Not a dashboard path.");
        }
        const url = new URL(`/dashboard${request.path}`, origin);
        if (url.origin !== origin || !url.pathname.startsWith("/dashboard/")) {
          throw new Error("Not a dashboard path.");
        }
        deps.openTab(url.toString());
        return {};
      }
      case "signOut":
        await deps.signOut();
        return {};
      default:
        // A newer panel asking for something this shell predates.
        throw new Error("This version of Exeora for Chrome cannot do that. Update it.");
    }
  }

  function disconnect() {
    if (disposed) return;
    disposed = true;
    deps.onDisconnect();
  }

  function serve(connected: ShellPort) {
    connected.addEventListener("message", (event) => {
      if (isByeMessage(event.data)) return disconnect();
      if (disposed || !isPanelMessage(event.data)) return;
      const { id, request } = event.data;
      const reply = (message: ShellMessage) => {
        if (!disposed) connected.postMessage(message);
      };
      answer(request).then(
        (result) => reply({ exeora: "shell", id, ok: true, result }),
        (error: unknown) =>
          reply({
            exeora: "shell",
            id,
            ok: false,
            error: error instanceof Error ? error.message : "Something went wrong.",
          }),
      );
    });
    connected.addEventListener("close", disconnect);
    connected.start();
  }

  return {
    /** For the shell window's `message` events. */
    onMessage(event: Pick<MessageEvent, "data" | "origin" | "source" | "ports">): void {
      // One document per load: a second `connect`, from whatever the frame
      // shows next, is refused, and the first one's port closing reloads it.
      if (port || disposed) return;
      const frame = deps.frame();
      if (!frame || event.source !== frame || event.origin !== origin) return;
      const [carried] = event.ports;
      if (!isConnectMessage(event.data) || !carried) return;
      port = carried;
      serve(carried);
    },

    /** Stops answering, without calling `onDisconnect`: the frame is being replaced. */
    dispose(): void {
      disposed = true;
      port?.close();
    },
  };
}
