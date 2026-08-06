import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  // Static output: the landing has no server-side work to do, and plain HTML
  // is what makes it fast and indexable.
  output: "static",
  vite: { plugins: [tailwind()] },
});
