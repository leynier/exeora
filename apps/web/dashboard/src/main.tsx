import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { storedToken } from "./auth.js";
import { ToastProvider } from "./components/toast.js";
import { AppShell } from "./layouts/AppShell.js";
import { Activity } from "./pages/Activity.js";
import { Admin } from "./pages/Admin.js";
import { AdminUser } from "./pages/AdminUser.js";
import { AdminUsers } from "./pages/AdminUsers.js";
import { Callback } from "./pages/Callback.js";
import { Clients } from "./pages/Clients.js";
import { Machines } from "./pages/Machines.js";
import { Overview } from "./pages/Overview.js";
import { ProjectDetail } from "./pages/ProjectDetail.js";
import { Projects } from "./pages/Projects.js";
import { Settings } from "./pages/Settings.js";
import { SignIn } from "./pages/SignIn.js";
import { useMe } from "./queries.js";
import "./index.css";

const Workspace = lazy(() =>
  import("./pages/Workspace.js").then((module) => ({ default: module.Workspace })),
);
const WorkspaceRedirect = lazy(() =>
  import("./pages/Workspace.js").then((module) => ({ default: module.WorkspaceRedirect })),
);

/**
 * The dashboard.
 *
 * Routing is real rather than a pathname check, which is what the gateway's
 * asset handler already assumes: it serves this shell for any /dashboard/*
 * that is not a file, so a deep link and a reload both land here.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A revoked device or a failed call should not be retried into a spinner
      // that never resolves; surface it and let the polling interval recover.
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * Sends anyone without a usable token to the sign-in screen, remembering where
 * they were headed so the deep link survives the round trip.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (storedToken()) return children;

  return (
    <Navigate
      to="/signin"
      replace
      state={{ from: `/dashboard${location.pathname}${location.search}` }}
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

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The SPA is mounted under /dashboard/ by the Worker, so every route
          below is written without that prefix. */}
      <BrowserRouter basename="/dashboard">
        <ToastProvider>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/callback" element={<Callback />} />

            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Overview />} />
              <Route path="machines" element={<Machines />} />
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
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
