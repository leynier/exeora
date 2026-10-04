import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ToastProvider } from "./components/toast.js";
import { DashboardRoutes } from "./routes.js";
import "./index.css";

/**
 * The dashboard.
 *
 * Routing is real rather than a pathname check, which is what the gateway's
 * asset handler already assumes: it serves this shell for any /dashboard/*
 * that is not a file, so a deep link and a reload both land here. The routes
 * themselves are shared with the dashboard ChatGPT shows (`mcp-dashboard/`).
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A revoked machine or a failed call should not be retried into a spinner
      // that never resolves; surface it and let the polling interval recover.
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The SPA is mounted under /dashboard/ by the Worker, so every route
          below is written without that prefix. */}
      <BrowserRouter basename="/dashboard">
        <ToastProvider>
          <DashboardRoutes />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
