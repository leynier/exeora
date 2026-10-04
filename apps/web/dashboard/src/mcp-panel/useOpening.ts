import { useCallback, useEffect, useRef, useState } from "react";
import { configureTicketOrigin } from "../socket-url.js";
import type { Host, HostState } from "./host.js";
import { fileInput, type Opening, resolveOpening } from "./opening.js";
import { applySettings, gatewayOrigin, type PanelSelection } from "./selection.js";
import type { ToolAnswer } from "./transport.js";

/** How long to wait for the host to hand over the result of the call that opened the panel. */
const RESULT_WAIT_MS = 30_000;
/** How long to wait for any sign of that call before making it ourselves. */
const INPUT_WAIT_MS = 4_000;

export type Phase =
  | { kind: "waiting" }
  | { kind: "opening" }
  | (Opening & { kind: "failed" })
  /** `sequence` counts openings, so the same place asked for twice is still a move. */
  | (Opening & { kind: "ready"; sequence: number });

type Attempt = { sequence: number; fromHost: boolean };

/**
 * Turns what the host says into what the panel shows.
 *
 * The first opening uses the result the host hands over. A retry, or a host
 * that never sent one, calls the gateway afresh. A panel kept open in a
 * thread hears of later calls too: each new result opens again, over the
 * Workspace already showing rather than in place of it.
 */
export function useOpening(
  host: Host,
  state: HostState,
): Phase & { retry: () => void; browse: () => void } {
  const [phase, setPhase] = useState<Phase>({ kind: "waiting" });
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  /** The host's result the last opening already accounted for. */
  const used = useRef<ToolAnswer | null>(null);
  const next = useCallback(
    (fromHost: boolean) =>
      setAttempt((current) => ({ sequence: (current?.sequence ?? -1) + 1, fromHost })),
    [],
  );
  const retry = useCallback(() => next(false), [next]);
  const connected = state.connection === "connected";
  const hasInput = state.input !== null;
  const settled = state.result !== null || state.cancelled;

  useEffect(() => {
    if (!connected || attempt !== null) return;
    if (settled) return next(true);
    const timer = setTimeout(() => next(false), hasInput ? RESULT_WAIT_MS : INPUT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [connected, attempt, settled, hasInput, next]);

  useEffect(() => {
    if (attempt === null) return;
    const { input, result, cancelled, fileAccess } = host.state();
    used.current = result;
    setPhase((current) => (current.kind === "ready" ? current : { kind: "opening" }));
    let live = true;
    const fromHost = attempt.fromHost && !cancelled ? result : null;
    resolveOpening({ input, result: fromHost, fileAccess }, host.call)
      .catch(
        (error: unknown): Opening => ({
          kind: "failed",
          message: error instanceof Error ? error.message : "Exeora did not answer.",
          file: fileInput(input),
        }),
      )
      .then((opening) => {
        if (!live) return;
        if (opening.kind === "failed") return setPhase(opening);
        // Before the Workspace mounts, since it reads its preferences once.
        applySettings(opening.selection.settings);
        const gateway = gatewayOrigin(opening.selection);
        if (gateway) configureTicketOrigin(gateway);
        setPhase({ ...opening, sequence: attempt.sequence });
      });
    return () => {
      live = false;
    };
  }, [attempt, host]);

  // After the opening above, so a result it has just taken is not taken again.
  useEffect(() => {
    if (attempt === null || !state.result || state.result === used.current) return;
    next(true);
  }, [attempt, state.result, next]);

  // A file that cannot be placed still leaves the Workspace to browse.
  const browse = useCallback(
    () => setPhase({ kind: "ready", selection: NOTHING_SELECTED, file: null, sequence: -1 }),
    [],
  );

  return { ...phase, retry, browse };
}

const NOTHING_SELECTED: PanelSelection = {
  projectId: null,
  workspace: null,
  path: null,
  settings: {
    defaultProject: null,
    defaultWorkspace: null,
    view: null,
    showIgnored: null,
    diffStyle: null,
  },
  gatewayOrigin: null,
};
