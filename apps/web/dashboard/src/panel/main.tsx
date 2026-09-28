import { type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { configureApiSession } from "../api.js";
import "../index.css";
import { type Bridge, createBridge, framingExtension } from "./bridge.js";
import { Panel } from "./Panel.js";
import { PANEL_PROTOCOL } from "./protocol.js";

/**
 * Exeora for Chrome's side panel, served by the gateway and framed by the
 * extension. See `protocol.ts` for why it lives here rather than in the
 * extension's own bundle.
 */

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

const shell = framingExtension();

function start(bridge: Bridge) {
  // Same origin as the API: only the token comes from the extension.
  configureApiSession({
    origin: "",
    token: async () => (await bridge.request({ kind: "token" })).token,
  });
  return bridge;
}

const bridge = shell
  ? start(
      createBridge({
        parent: window.parent,
        parentOrigin: shell,
        listen: (handler) => {
          window.addEventListener("message", handler);
          return () => window.removeEventListener("message", handler);
        },
      }),
    )
  : null;

createRoot(root).render(
  <StrictMode>{bridge ? <Handshake bridge={bridge} /> : <NotFramed />}</StrictMode>,
);

type Shake = "waiting" | "ready" | "outdated" | "silent";

/** Waits for the shell to say it is listening, and speaks a version this page needs. */
function Handshake({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<Shake>("waiting");

  useEffect(() => {
    let live = true;
    bridge.request({ kind: "ready" }).then(
      ({ protocol }) => live && setState(protocol >= PANEL_PROTOCOL ? "ready" : "outdated"),
      () => live && setState("silent"),
    );
    return () => {
      live = false;
    };
  }, [bridge]);

  if (state === "waiting") return null;
  if (state === "ready") return <Panel bridge={bridge} />;
  return (
    <Notice
      text={
        state === "outdated"
          ? "This version of Exeora for Chrome is too old for the panel. Update it from chrome://extensions."
          : "The Exeora extension did not answer. Close and reopen the side panel."
      }
    />
  );
}

/** The page opened on its own, where there is no extension to sign in with. */
function NotFramed() {
  return (
    <Notice text="This page is the side panel of Exeora for Chrome.">
      <a className="btn" href="/dashboard/">
        Open the dashboard
      </a>
    </Notice>
  );
}

function Notice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-body-md text-foreground-muted">{text}</p>
      {children}
    </div>
  );
}
