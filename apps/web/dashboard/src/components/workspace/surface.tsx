import { createContext, type ReactNode, useContext } from "react";
import { useLocation } from "react-router";
import { EmptyState } from "../ui.js";

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
}

const SurfaceContext = createContext<WorkspaceSurface | null>(null);

export const WorkspaceSurfaceProvider = SurfaceContext.Provider;

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
