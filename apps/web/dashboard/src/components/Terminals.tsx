import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type Location, useLocation, useNavigate } from "react-router";
import type { Project } from "../api.js";
import { api } from "../api.js";
import { useOpenTerminals, useProjects } from "../queries.js";
import { canonicalSelector } from "../selectors.js";
import {
  type ListedTerminal,
  listedTerminalTarget,
  terminalSessionKey,
} from "../workspacePaths.js";
import { type OpenTerminalSession, OpenTerminals, sessionLabel } from "./OpenTerminals.js";

// xterm is only needed once a terminal is actually opened. Keeping it behind
// this boundary makes the Workspace route responsive for users who only browse
// source control or files.
const WebTerminal = lazy(() =>
  import("./WebTerminal.js").then((module) => ({ default: module.WebTerminal })),
);

type TerminalsApi = {
  sessions: OpenTerminalSession[];
  killing: string | null;
  openSession: (session: OpenTerminalSession) => void;
  closeSession: (session: OpenTerminalSession) => void;
  focusSession: (session: OpenTerminalSession) => void;
  onExit: (key: string) => void;
  workspaceFills: boolean;
  /**
   * Where the Workspace screen wants its terminal drawn: an element inside
   * its own frame, beside the column of views. Null while no such screen is up.
   */
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
};

const TerminalsContext = createContext<TerminalsApi | null>(null);

export function useTerminals(): TerminalsApi {
  const value = useContext(TerminalsContext);
  if (!value) throw new Error("TerminalsProvider is required.");
  return value;
}

export function TerminalsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<OpenTerminalSession[]>([]);
  const [killing, setKilling] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const closed = useRef(new Set<string>());
  const location = useLocation();
  const navigate = useNavigate();
  const remote = useOpenTerminals();
  const projects = useProjects();

  // Not before the projects are known: which root a listed terminal is in
  // can only be told apart from the default one by the project's locations.
  useEffect(() => {
    if (!remote.data || !projects.data) return;
    const known = projects.data;
    setSessions((current) => mergeRemote(current, remote.data.items, closed.current, known));
  }, [remote.data, projects.data]);

  const openSession = useCallback((session: OpenTerminalSession) => {
    closed.current.delete(session.key);
    setSessions((current) =>
      current.some((item) => item.key === session.key) ? current : [...current, session],
    );
  }, []);

  const closeSession = useCallback((session: OpenTerminalSession) => {
    closed.current.add(session.key);
    setKilling(session.key);
    // The socket only reaches the shell when it is attached. Ending it on the
    // server as well covers a session this tab never managed to attach to.
    void api.closeTerminal(session.projectId, session.workspaceId).catch(() => undefined);
  }, []);

  const focusSession = useCallback(
    (session: OpenTerminalSession) => {
      const params = new URLSearchParams();
      params.set("project", session.projectId);
      if (session.workspaceSlug) params.set("workspace", session.workspaceSlug);
      params.set("view", "terminal");
      navigate({ pathname: "/workspace", search: params.toString() });
    },
    [navigate],
  );

  const onExit = useCallback((key: string) => {
    closed.current.add(key);
    setKilling((current) => (current === key ? null : current));
    setSessions((current) => current.filter((item) => item.key !== key));
  }, []);

  const workspaceFills =
    isWorkspaceTerminalView(location) &&
    sessions.some((session) => matchesLocation(session, location));

  const value = useMemo(
    () => ({
      sessions,
      killing,
      openSession,
      closeSession,
      focusSession,
      onExit,
      workspaceFills,
      slot,
      setSlot,
    }),
    [sessions, killing, openSession, closeSession, focusSession, onExit, workspaceFills, slot],
  );

  return <TerminalsContext.Provider value={value}>{children}</TerminalsContext.Provider>;
}

/**
 * Every open terminal, alive for as long as the tab is, whichever page is up.
 *
 * The shells live in one element that is never re-created, so moving between
 * pages never drops a session. Elsewhere it is a row of chips along the
 * bottom of the page. On the Workspace screen's Terminal view it is moved into
 * the slot that view leaves in its frame, so the terminal sits beside the
 * column of views like every other view does, and moved back when the view
 * changes: the element moves, the shells in it are not touched.
 */
export function GlobalTerminals() {
  const { sessions, killing, focusSession, closeSession, onExit, workspaceFills, slot } =
    useTerminals();
  const location = useLocation();
  const projects = useProjects();
  const [host] = useState(() => document.createElement("div"));
  const home = useRef<HTMLDivElement>(null);
  const inSlot = workspaceFills && slot !== null;
  const any = sessions.length > 0;

  useLayoutEffect(() => {
    if (!any) {
      host.remove();
      return;
    }
    const target = inSlot ? slot : home.current;
    if (target && host.parentElement !== target) target.appendChild(host);
    host.className = inSlot
      ? "flex min-h-0 flex-1 flex-col"
      : "border-border-subtle shrink-0 border-t px-4 py-3 lg:px-6";
  }, [any, inSlot, slot, host]);

  useEffect(() => () => host.remove(), [host]);

  const active = sessions.find((session) => matchesLocation(session, location)) ?? sessions[0];
  if (!active) return null;

  const content = (
    <>
      <OpenTerminals
        sessions={sessions}
        activeKey={active.key}
        projects={projects.data ?? []}
        className={inSlot ? "mb-3" : ""}
        onSelect={focusSession}
        onClose={closeSession}
      />
      {sessions.map((session) => {
        const shown = inSlot && session.key === active.key;
        return (
          <div
            key={session.key}
            className={shown ? "flex min-h-0 flex-1 flex-col" : "pointer-events-none hidden"}
          >
            <Suspense fallback={<TerminalLoading />}>
              <WebTerminal
                projectId={session.projectId}
                workspace={session.workspaceId}
                targetLabel={sessionLabel(session, projects.data ?? [])}
                available
                active={shown}
                autoConnect
                kill={killing === session.key}
                onExit={() => onExit(session.key)}
              />
            </Suspense>
          </div>
        );
      })}
    </>
  );

  return (
    <>
      <div ref={home} className={inSlot ? "hidden" : "contents"} />
      {createPortal(content, host)}
    </>
  );
}

function TerminalLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center text-sm text-gray-500">
      Loading terminal…
    </div>
  );
}

/**
 * The place a terminal is drawn on the Workspace screen: an empty element
 * that the open terminals are moved into for as long as it is on screen.
 */
export function TerminalSlot() {
  const { setSlot } = useTerminals();
  return <div ref={setSlot} data-testid="terminal-slot" className="flex min-h-0 flex-1 flex-col" />;
}

export function isWorkspaceTerminalView(location: Location): boolean {
  return (
    location.pathname === "/workspace" &&
    new URLSearchParams(location.search).get("view") === "terminal"
  );
}

function matchesLocation(session: OpenTerminalSession, location: Location): boolean {
  const search = new URLSearchParams(location.search);
  return (
    session.projectId === (search.get("project") ?? "") &&
    (session.workspaceSlug ?? null) === search.get("workspace")
  );
}

function mergeRemote(
  local: OpenTerminalSession[],
  items: ListedTerminal[],
  closed: Set<string>,
  projects: readonly Project[],
): OpenTerminalSession[] {
  const next = [...local];
  for (const item of items) {
    const project = projects.find((candidate) => candidate.id === item.projectId);
    // A terminal with no workspace id is in a root, and not for that reason
    // in the default location's: the slug says which, when it says anything.
    const listed = listedTerminalTarget(item);
    const selector = item.workspaceId
      ? (item.workspaceSlug ?? null)
      : canonicalSelector(listed, project);
    const target = item.workspaceId ?? selector ?? undefined;
    const key = terminalSessionKey(item.projectId, target);
    if (closed.has(key) || next.some((session) => session.key === key)) continue;
    next.push({
      key,
      projectId: item.projectId,
      workspaceId: target,
      workspaceSlug: selector,
      // Empty for a root: its name is read from the project when the session
      // is shown, which is where its branch and its locations are known.
      label: item.workspaceId ? (item.workspaceSlug ?? "") : "",
    });
  }
  return next;
}
