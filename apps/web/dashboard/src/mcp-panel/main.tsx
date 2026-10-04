import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApiSession } from "../api.js";
import { configureExternalOpener } from "../external-url.js";
import { configureTicketOrigin } from "../socket-url.js";
import "../index.css";
import { connectHost } from "./host.js";
import { McpPanel } from "./McpPanel.js";
import { ensureStorage, routeLinksToHost } from "./sandbox.js";
import { gatewayOrigin } from "./selection.js";
import { toolTransport } from "./transport.js";

/**
 * The Workspace as an MCP App in ChatGPT, served by the gateway as the
 * `ui://exeora/workspace` resource. Unlike the Chrome side panel it never
 * holds a token: the host carries every request to the gateway as a call to
 * an app-only tool, on the connection the user already authorized.
 */

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ensureStorage(window);
const host = connectHost();
// An opaque sandbox reports "null", which is no origin to bind a ticket to.
const origin = window.location.origin.startsWith("https://") ? window.location.origin : undefined;
configureApiSession({ transport: toolTransport(host.call, origin) });
// Terminal and log tickets come from the gateway the resource's <base> names,
// not from the sandbox this page runs on.
configureTicketOrigin(gatewayOrigin(null));
const open = (url: string) => void host.openLink(url);
configureExternalOpener(open);
routeLinksToHost(document, open);

createRoot(root).render(
  <StrictMode>
    <McpPanel host={host} />
  </StrictMode>,
);
