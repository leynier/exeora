import { useEffect, useRef, useState } from "react";
import { PANEL_PATH } from "../../../web/dashboard/src/panel/protocol.js";
import { createShell } from "../../lib/bridge.js";
import { auth, GATEWAY, openTab } from "../../lib/session.js";

/** Long enough for a cold load on a slow network, short enough to say something. */
const LOAD_TIMEOUT_MS = 20_000;

/**
 * The signed-in side panel: the gateway's `/dashboard/panel`, framed.
 *
 * Everything on it is served by the gateway, so it changes with every deploy
 * and never needs a new version of the extension. What it cannot do from a
 * web page (hold the session, open a tab, sign out) it asks this shell for
 * through `lib/bridge.ts`.
 */
export function Panel() {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  // Bumped to remount the frame, which loads the panel again.
  const [attempt, setAttempt] = useState(0);
  const reload = () => {
    setState("loading");
    setAttempt((value) => value + 1);
  };

  useEffect(() => {
    if (state !== "loading") return;
    const timer = setTimeout(() => setState("failed"), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div className="relative h-full">
      <Frame
        key={attempt}
        visible={state === "ready"}
        onReady={() => setState("ready")}
        // The panel's document went away: a link took the frame elsewhere, or
        // it crashed. Whatever is there now gets no answers; load the panel.
        onDisconnect={reload}
      />
      {state === "ready" ? null : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          {state === "loading" ? (
            <p className="text-body-md text-foreground-muted">Loading…</p>
          ) : (
            <>
              <p className="text-body-md text-foreground-muted">
                Could not load Exeora from {new URL(GATEWAY).host}.
              </p>
              <button type="button" className="btn" onClick={reload}>
                Try again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One load of the panel, and the shell that answers it. */
function Frame({
  visible,
  onReady,
  onDisconnect,
}: {
  visible: boolean;
  onReady: () => void;
  onDisconnect: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Read through refs so the shell is made once per frame, not per render.
  const callbacks = useRef({ onReady, onDisconnect });
  callbacks.current = { onReady, onDisconnect };

  useEffect(() => {
    const shell = createShell({
      gateway: GATEWAY,
      frame: () => frame.current?.contentWindow ?? null,
      token: (options) => auth.token(options),
      openTab,
      // The app follows storage, so it replaces this frame with the sign-in
      // screen as soon as the session is gone.
      signOut: () => auth.signOut(),
      onReady: () => callbacks.current.onReady(),
      onDisconnect: () => callbacks.current.onDisconnect(),
    });
    window.addEventListener("message", shell.onMessage);
    return () => {
      window.removeEventListener("message", shell.onMessage);
      shell.dispose();
    };
  }, []);

  return (
    <iframe
      ref={frame}
      src={`${GATEWAY}${PANEL_PATH}`}
      title="Exeora"
      // The workspace's copy buttons and the terminal's paste.
      allow="clipboard-read; clipboard-write"
      className={`block size-full border-0 ${visible ? "" : "invisible"}`}
    />
  );
}
