import { lazy, type ReactNode, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./authContext.js";
import { EnsureAnnotations } from "./components/comments/annotations.js";
import { TerminalsProvider } from "./components/Terminals.js";
import { AppShell } from "./layouts/AppShell.js";
import { Activity } from "./pages/Activity.js";
import { Admin } from "./pages/Admin.js";
import { AdminUser } from "./pages/AdminUser.js";
import { AdminUsers } from "./pages/AdminUsers.js";
import { Clients } from "./pages/Clients.js";
import { Machines } from "./pages/Machines.js";
import { Overview } from "./pages/Overview.js";
import { ProjectDetail } from "./pages/ProjectDetail.js";
import { Projects } from "./pages/Projects.js";
import { Settings } from "./pages/Settings.js";
import { useMe } from "./queries.js";

const Workspace = lazy(() =>
  import("./pages/Workspace.js").then((module) => ({ default: module.Workspace })),
);
const WorkspaceRedirect = lazy(() =>
  import("./pages/Workspace.js").then((module) => ({ default: module.WorkspaceRedirect })),
);

/**
 * Every screen of the dashboard, under whichever router hosts it: the
 * browser's in its own tab, one in memory inside ChatGPT. Signing in and out
 * comes from the `AuthProvider` around it.
 */
export function DashboardRoutes() {
  const auth = useAuth();
  return (
    <Routes>
      <Route path="/signin" element={<auth.SignIn />} />
      <Route path="/callback" element={<auth.Callback />} />

      <Route
        element={
          <RequireAuth>
            <TerminalsProvider>
              {/* One account's waiting comments, for as long as it is signed in
                  here: across Workspace tabs, files and other screens. An
                  embedding that gave its own (ChatGPT's) keeps it. */}
              <EnsureAnnotations>
                <AppShell />
              </EnsureAnnotations>
            </TerminalsProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Overview />} />
        <Route path="machines" element={<Machines />} />
        {/* Exeora Cloud was a page of its own once. Links to it still
            arrive, and what it showed is a tab of Machines now. */}
        <Route path="cloud" element={<Navigate to="/machines?view=cloud" replace />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectDetail />} />
        <Route
          path="workspace"
          element={
            <Suspense fallback={null}>
              <Workspace />
            </Suspense>
          }
        />
        <Route
          path="projects/:projectId/workspace"
          element={
            <Suspense fallback={null}>
              <WorkspaceRedirect />
            </Suspense>
          }
        />
        <Route path="clients" element={<Clients />} />
        <Route path="activity" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <Outlet />
            </RequireAdmin>
          }
        >
          <Route index element={<Admin />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:userId" element={<AdminUser />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Sends anyone without a usable token to the sign-in screen, remembering where
 * they were headed so the deep link survives the round trip.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const auth = useAuth();
  if (auth.signedIn) return children;

  return (
    <Navigate
      to="/signin"
      replace
      state={{ from: `${auth.returnPrefix}${location.pathname}${location.search}` }}
    />
  );
}

/**
 * Keeps the admin pages off the ordinary accounts' UI. The server still 404s
 * every admin call for non-admins; this is only so the shell never renders.
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading || me.isError) return null;
  if (me.data?.isAdmin !== true) return <Navigate to="/" replace />;
  return children;
}
