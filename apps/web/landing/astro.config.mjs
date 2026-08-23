import sitemap from "@astrojs/sitemap";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  // Static output: the landing has no server-side work to do, and plain HTML
  // is what makes it fast and indexable.
  output: "static",

  // Needed for canonical URLs, Open Graph and the sitemap. The gateway serves
  // this build at the same origin.
  site: "https://exeora.dev",

  // The stylesheet is a few kilobytes once Tailwind has pruned it, so inlining
  // it costs less than the round trip it saves.
  build: { inlineStylesheets: "always" },

  // The dashboard needs a token to render and the OAuth screens send
  // `noindex`, so the static pages the integration can see are exactly the
  // ones that belong in the sitemap.
  integrations: [sitemap()],

  vite: {
    plugins: [tailwind()],
    server: {
      // Amp review portals use a per-thread onamp.dev hostname in development.
      // Keep the allowance scoped to that suffix rather than accepting every host.
      allowedHosts: [".onamp.dev"],
    },
  },
});
