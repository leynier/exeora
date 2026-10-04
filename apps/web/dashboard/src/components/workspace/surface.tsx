import { createContext, type ReactNode, useContext } from "react";
import { useLocation } from "react-router";
import { EmptyState } from "../ui.js";
import type { Detail, WorkspaceView } from "./workspaceLayout.js";

/**
 * Where the Workspace screen is shown, when that is not the dashboard.
 *
 * ChatGPT gets the files, Git and terminal views, carried by a narrow set of
 * gateway routes; what needs the owner's dashboard (pull requests, among
 * others) says so there and links to it instead of failing call by call. The
 * dashboard and the Chrome side panel provide nothing and see every view.
 */
export interface WorkspaceSurface {
  /** Opens a dashboard path (starting with `/`) outside the frame. */
  openDashboard: (path: string) => void;
  /** Hears what the Workspace shows, as it changes. */
  report?: (snapshot: WorkspaceSnapshot) => void;
  /**
   * Stands between a change of project or working copy and its unsaved
   * edits: `proceed` runs now, after the person confirms, or never.
   */
  changeTarget?: (to: WorkspaceTarget, proceed: () => void) => void;
}

/** A project and the working copy in it, as the address names them. */
export interface WorkspaceTarget {
  projectId: string | null;
  /** The selector in `?workspace=`; null for the default root. */
  workspace: string | null;
}

/** What the Workspace shows: where, which view, and which files are open. */
export interface WorkspaceSnapshot extends WorkspaceTarget {
  /** What its tabs, buffers and searches are kept under. */
  targetKey: string;
  /**
   * The project's locations, once known: what tells the root of the default
   * location (`main`, nothing, `main@<its slug>`) from another's.
   */
  locations: { slug: string; default: boolean }[] | null;
  view: WorkspaceView;
  openPaths: string[];
  active: Detail | null;
}

export function useWorkspaceSurface(): WorkspaceSurface | null {
  return useContext(SurfaceContext);
}

const SurfaceContext = createContext<WorkspaceSurface | null>(null);

export const WorkspaceSurfaceProvider = SurfaceContext.Provider;

/**
 * Who hears what the Workspace shows and stands between it and a change of
 * working copy, without limiting it: the full Dashboard in ChatGPT, while
 * ChatGPT may move it. An embedding's surface does both too.
 */
export type WorkspaceControl = Pick<WorkspaceSurface, "report" | "changeTarget">;

const ControlContext = createContext<WorkspaceControl | null>(null);

export const WorkspaceControlProvider = ControlContext.Provider;

export function useWorkspaceControl(): WorkspaceControl | null {
  const surface = useContext(SurfaceContext);
  const control = useContext(ControlContext);
  return surface ?? control;
}

/**
 * Whether account features (AI Assist, GitHub) are out of reach here, so the
 * views do not ask the gateway for them only to be refused.
 */
export function useAccountFeatures(): boolean {
  return useContext(SurfaceContext) === null;
}

/** Its children in the dashboard; elsewhere, a way there. */
export function DashboardOnly({ feature, children }: { feature: string; children: ReactNode }) {
  const surface = useContext(SurfaceContext);
  const location = useLocation();
  if (!surface) return children;
  return (
    <EmptyState title={`${feature} open in the dashboard`}>
      <p>This view needs the full Exeora dashboard.</p>
      <button
        type="button"
        className="btn mt-3"
        onClick={() => surface.openDashboard(`${location.pathname}${location.search}`)}
      >
        Open in dashboard
      </button>
    </EmptyState>
  );
}
