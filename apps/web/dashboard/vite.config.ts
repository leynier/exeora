import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "dashboard",
  // Served from /dashboard/ by the Worker, so every asset URL must carry that
  // prefix or the SPA shell will request them from the landing's root.
  base: "/dashboard/",
  plugins: [react(), tailwind()],
  build: { outDir: "../public/dashboard", emptyOutDir: true },
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
