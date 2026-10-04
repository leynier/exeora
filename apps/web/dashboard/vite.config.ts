import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "dashboard",
  // Served from /dashboard/ by the Worker, so every asset URL must carry that
  // prefix or the SPA shell will request them from the landing's root.
  base: "/dashboard/",
  plugins: [react(), tailwind()],
  build: {
    outDir: "../public/dashboard",
    emptyOutDir: true,
    // The dashboard, the side panel Exeora for Chrome frames from here
    // (`/dashboard/panel`), so a deploy updates the panel with no new version
    // of the extension, and the Workspace the gateway serves to ChatGPT as an
    // MCP App resource (`mcp-panel.html`), and the whole dashboard ChatGPT shows
    // behind the plugin's global entrypoint (`mcp-dashboard.html`). All of
    // them share their chunks.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        panel: fileURLToPath(new URL("./panel.html", import.meta.url)),
        "mcp-panel": fileURLToPath(new URL("./mcp-panel.html", import.meta.url)),
        "mcp-dashboard": fileURLToPath(new URL("./mcp-dashboard.html", import.meta.url)),
      },
    },
  },
  // The fonts live in the landing's public/ and are served from the same
  // origin in production, so `vite dev` has to reach for them too.
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/oauth": "http://localhost:8787",
      "/fonts": "http://localhost:8787",
    },
  },
});
