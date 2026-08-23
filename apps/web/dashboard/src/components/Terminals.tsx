import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Location, useLocation, useNavigate } from "react-router";
import { useOpenTerminals, useProjects } from "../queries.js";
import { type ListedTerminal, terminalSessionKey } from "../workspacePaths.js";
import { type OpenTerminalSession, OpenTerminals } from "./OpenTerminals.js";
import { WebTerminal } from "./WebTerminal.js";

type TerminalsApi = {
  sessions: OpenTerminalSession[];
  killing: string | null;
  openSession: (session: OpenTerminalSession) => void;
  closeSession: (session: OpenTerminalSession) => void;
  focusSession: (session: OpenTerminalSession) => void;
  onExit: (key: string) => void;
  workspaceFills: boolean;
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
  const closed = useRef(new Set<string>());
  const location = useLocation();
  const navigate = useNavigate();
  const remote = useOpenTerminals();

  useEffect(() => {
    if (!remote.data) return;
    setSessions((current) => mergeRemote(current, remote.data.items, closed.current));
  }, [remote.data]);

  const openSession = useCallback((session: OpenTerminalSession) => {
    closed.current.delete(session.key);
    setSessions((current) =>
      current.some((item) => item.key === session.key) ? current : [...current, session],
    );
  }, []);

  const closeSession = useCallback((session: OpenTerminalSession) => {
    closed.current.add(session.key);
    setKilling(session.key);
  }, []);

  const focusSession = useCallback(
    (session: OpenTerminalSession) => {
      const params = new URLSearchParams();
      params.set("project", session.projectId);
      if (session.worktreeSlug) params.set("worktree", session.worktreeSlug);
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
    }),
    [sessions, killing, openSession, closeSession, focusSession, onExit, workspaceFills],
  );

  return <TerminalsContext.Provider value={value}>{children}</TerminalsContext.Provider>;
}

export function GlobalTerminals() {
  const { sessions, killing, focusSession, closeSession, onExit, workspaceFills } = useTerminals();
  const location = useLocation();
  const projects = useProjects();
  if (sessions.length === 0) return null;
  const active = sessions.find((session) => matchesLocation(session, location)) ?? sessions[0];
  if (!active) return null;

  return (
    <div
      className={
        workspaceFills
          ? "flex min-h-0 flex-1 flex-col px-4 pb-4 lg:px-6"
          : "border-border-subtle shrink-0 border-t px-4 py-3 lg:px-6"
      }
    >
      <OpenTerminals
        sessions={sessions}
        activeKey={active.key}
        projects={projects.data ?? []}
        className={workspaceFills ? "mb-3" : ""}
        onSelect={focusSession}
        onClose={closeSession}
      />
      {sessions.map((session) => {
        const shown = workspaceFills && session.key === active.key;
        return (
          <div
            key={session.key}
            className={shown ? "flex min-h-0 flex-1 flex-col" : "pointer-events-none hidden"}
          >
            <WebTerminal
              projectId={session.projectId}
              worktree={session.worktreeId}
              targetLabel={session.label}
              available
              active={shown}
              autoConnect
              kill={killing === session.key}
              onExit={() => onExit(session.key)}
            />
          </div>
        );
      })}
    </div>
  );
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
    (session.worktreeSlug ?? null) === search.get("worktree")
  );
}

function mergeRemote(
  local: OpenTerminalSession[],
  items: ListedTerminal[],
  closed: Set<string>,
): OpenTerminalSession[] {
  const next = [...local];
  for (const item of items) {
    const key = terminalSessionKey(item.projectId, item.worktreeId);
    if (closed.has(key) || next.some((session) => session.key === key)) continue;
    next.push({
      key,
      projectId: item.projectId,
      worktreeId: item.worktreeId,
      worktreeSlug: item.worktreeSlug ?? null,
      label: item.worktreeSlug ?? "project root",
    });
  }
  return next;
}
