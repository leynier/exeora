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
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  // Bumped to remount the frame, which reloads it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const handle = createShell({
      gateway: GATEWAY,
      frame: () => frame.current?.contentWindow ?? null,
      token: (options) => auth.token(options),
      openTab,
      // The app follows storage, so it replaces this frame with the sign-in
      // screen as soon as the session is gone.
      signOut: () => auth.signOut(),
      onReady: () => setState("ready"),
    });
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, []);

  useEffect(() => {
    if (state !== "loading") return;
    const timer = setTimeout(() => setState("failed"), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div className="relative h-full">
      <iframe
        key={attempt}
        ref={frame}
        src={`${GATEWAY}${PANEL_PATH}`}
        title="Exeora"
        // The workspace's copy buttons and the terminal's paste.
        allow="clipboard-read; clipboard-write"
        className={`block size-full border-0 ${state === "ready" ? "" : "invisible"}`}
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
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setState("loading");
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
