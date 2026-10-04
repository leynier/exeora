import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApiSession } from "../api.js";
import { configureExternalOpener } from "../external-url.js";
import { configureTicketOrigin } from "../socket-url.js";
import "../index.css";
import { CommentStore, openaiWidgetState } from "../components/comments/store.js";
import { configureWorkspaceScope } from "../components/workspace/scope.js";
import { ContextWriter } from "./comments/contextWriter.js";
import { panelAnnotations } from "./comments/PanelComments.js";
import { PanelController } from "./controller.js";
import { connectHost } from "./host.js";
import { McpPanel } from "./McpPanel.js";
import { PanelRelay, toolTickets } from "./relay.js";
import { ensureStorage, routeLinksToHost } from "./sandbox.js";
import { gatewayOrigin } from "./selection.js";
import { APP_TOOLS, CONTROL_STOPPED, callAppTool, PANEL_CLOSED } from "./tools.js";
import { toolTransport } from "./transport.js";

/**
 * The Workspace as an MCP App in ChatGPT, served by the gateway as the
 * `ui://exeora/workspace` resource. Unlike the Chrome side panel it never
 * holds a token: the host carries every request to the gateway as a call to
 * an app-only tool, on the connection the user already authorized. The
 * model reads and moves this panel with the gateway's public Workspace tools,
 * carried here over the panel relay; hosts that discover app tools find the
 * same two answered by the panel itself.
 */

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ensureStorage(window);
// This panel's tabs, buffers and searches are its own, even where another
// panel shares the sandbox's storage.
configureWorkspaceScope(`panel-${crypto.randomUUID()}`);
const controller = new PanelController(
  (name, args, signal) => host.call(name, args, signal),
  undefined,
  () => relay.get().panelId,
);
// The tools are registered before connecting, as the host may list them at once.
const host = connectHost({
  tools: {
    list: () => APP_TOOLS,
    call: (name, args) =>
      callAppTool(controller, name, args, () => {
        const { status } = relay.get();
        return status === "closed" ? PANEL_CLOSED : status === "stopped" ? CONTROL_STOPPED : null;
      }),
  },
});
// An opaque sandbox reports "null", which is no origin to bind a ticket to.
const origin = window.location.origin.startsWith("https://") ? window.location.origin : undefined;
configureApiSession({ transport: toolTransport(host.call, origin) });
// Everything this panel puts in the model's context goes through one writer,
// which takes the host's word for what is attached. Comments wait in this
// panel (and in its private widget state, where the host keeps one) until the
// person adds them.
const writer = new ContextWriter(host.modelContext);
host.onModelContext((context) => writer.fromHost(context));
const comments = new CommentStore(openaiWidgetState(window));
// The relay's socket is a gateway address, opened with a one-use ticket
// bound to the origin this page runs on (the document's own, which a
// `srcdoc` frame inherits even where its location says "null").
const relay = new PanelRelay({
  controller,
  ticket: toolTickets(host.call, window.origin),
});
// Torn down by the host, the panel stops acting for the model at once, even
// if its frame stays mounted: the relay closes for good (nothing ChatGPT
// asked still lands, and nothing reconnects or resumes), and the model is
// told nothing more of where it is. Attached comments stay.
host.onTeardown(() => relay.dispose());
// Terminal and log tickets come from the gateway the resource's <base> names,
// not from the sandbox this page runs on.
configureTicketOrigin(gatewayOrigin(null));
const open = (url: string) => void host.openLink(url);
configureExternalOpener(open);
routeLinksToHost(document, open);

createRoot(root).render(
  <StrictMode>
    <McpPanel
      host={host}
      controller={controller}
      annotations={panelAnnotations(comments, writer)}
      writer={writer}
      relay={relay}
    />
  </StrictMode>,
);
