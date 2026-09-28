import {
  isPanelMessage,
  PANEL_PROTOCOL,
  type PanelRequest,
  type PanelResults,
  type ShellMessage,
} from "../../web/dashboard/src/panel/protocol.js";

/**
 * The shell's end of the conversation with the panel it frames.
 *
 * The panel is the gateway's page, so it is only ever answered when the
 * message comes from that frame and from the gateway's origin, and answers go
 * to that origin and nowhere else: they carry the access token.
 */

export interface ShellDeps {
  /** The gateway's origin, which the panel is served from. */
  gateway: string;
  /** The panel's window, once the frame exists. */
  frame: () => { postMessage(message: unknown, targetOrigin: string): void } | null;
  token: (options: { force?: boolean }) => Promise<string | null>;
  openTab: (url: string) => void;
  signOut: () => Promise<void>;
  /** Called when the panel says it is up, so the shell can stop showing its own loading state. */
  onReady: () => void;
}

type Result = PanelResults[PanelRequest["kind"]];

export function createShell(deps: ShellDeps) {
  const origin = new URL(deps.gateway).origin;

  async function answer(request: PanelRequest): Promise<Result> {
    switch (request.kind) {
      case "ready":
        deps.onReady();
        return { protocol: PANEL_PROTOCOL };
      case "token":
        return { token: await deps.token({ force: request.force === true }) };
      case "open": {
        // A path in the dashboard, never an address of the panel's choosing.
        if (typeof request.path !== "string" || !request.path.startsWith("/")) {
          throw new Error("Not a dashboard path.");
        }
        const url = new URL(`/dashboard${request.path}`, origin);
        if (url.origin !== origin) throw new Error("Not a dashboard path.");
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

  return (event: Pick<MessageEvent, "data" | "origin" | "source">): void => {
    const frame = deps.frame();
    if (!frame || event.source !== frame || event.origin !== origin) return;
    if (!isPanelMessage(event.data)) return;
    const { id, request } = event.data;
    answer(request).then(
      (result) => reply(frame, { exeora: "shell", id, ok: true, result }),
      (error: unknown) =>
        reply(frame, {
          exeora: "shell",
          id,
          ok: false,
          error: error instanceof Error ? error.message : "Something went wrong.",
        }),
    );
  };

  function reply(frame: NonNullable<ReturnType<ShellDeps["frame"]>>, message: ShellMessage) {
    frame.postMessage(message, origin);
  }
}
