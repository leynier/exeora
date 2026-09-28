import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "wxt";

/**
 * Exeora for Chrome.
 *
 * The side panel is the dashboard's Workspace screen, imported from
 * `apps/web/dashboard` rather than copied, so a fix there is a fix here. What
 * the extension adds is how it signs in and where its requests go.
 */

const dashboard = fileURLToPath(new URL("../web/dashboard/src", import.meta.url));
const fonts = fileURLToPath(new URL("../web/landing/public/fonts", import.meta.url));

/**
 * The public half of the key that pins the extension id to
 * `helnfgncjgikiojakjdfppmmflbdjamo`, which a development gateway's
 * `EXEORA_EXTENSION_IDS` names in `.dev.vars`; never production's, since the
 * key is public. Without it an unpacked build gets an id
 * derived from its folder, and its sign-in redirect would be refused. The
 * Chrome Web Store assigns its own id and refuses this field, so a store
 * build is made with `EXEORA_EXTENSION_KEY=omit`.
 */
const KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0IiKL9IrxlJ5wQuytQ+JIv5IhqTFEzg/sM0YD1YzfCpCtRZ6RWeCM1lIjMq+A56NzLKeYfA3LvFxeJzBWBiJwTd2NmIUS6aodWN+u0GwJfUxMWlrJoVBLEXerxrC6ZPHtEi6byYEJ41E21hc+dFvtnzL9psSDthguWYq9Sv3bUWP6EDQ2JXmM8aAr8bbkncdoCuCk7STQVXsqwqSj4+CXaxH03LfFattWgrC9YwqEMjUvzA2LBarcyWCkFheZmTGc6PyRS4P7N5vEsosJJs5wZNmY/1yabhjxmqQEaftq72+iuW4MXZA4C0/UrRmqzd5blPB8XQSoWlOnDN1/TzaPwIDAQAB";

/** Development talks to `bun run dev`; everything else to production. */
function gatewayUrl(mode: string): string {
  const configured = process.env.EXEORA_GATEWAY_URL;
  if (configured) return new URL(configured).origin;
  return mode === "development" ? "http://localhost:8787" : "https://exeora.dev";
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Also written into the generated tsconfig, so the editor resolves it too.
  alias: { "@dashboard": dashboard },
  manifest: ({ mode }) => ({
    name: "Exeora",
    description:
      "Review, commit and open terminals in your Exeora workspaces from Chrome's side panel.",
    permissions: ["sidePanel", "identity", "storage"],
    // Only the gateway: the panel calls its API and opens terminals on it, and
    // reads nothing from the pages it sits next to.
    host_permissions: [`${gatewayUrl(mode)}/*`],
    action: { default_title: "Open Exeora" },
    ...(process.env.EXEORA_EXTENSION_KEY === "omit" ? {} : { key: KEY }),
  }),
  vite: ({ mode }) => ({
    plugins: [tailwind()],
    define: { "import.meta.env.EXEORA_GATEWAY_URL": JSON.stringify(gatewayUrl(mode)) },
    resolve: {
      // The dashboard's files resolve their packages from apps/web. One copy of
      // each is what makes hooks and context work across the two trees.
      dedupe: [
        "react",
        "react-dom",
        "react-router",
        "@tanstack/react-query",
        // CodeMirror refuses a second copy of its state or view packages.
        "@codemirror/state",
        "@codemirror/view",
      ],
    },
  }),
  // `exeora-<version>-chrome.zip`, the file the release workflow submits.
  zip: { name: "exeora" },
  hooks: {
    // The dashboard's stylesheet loads its faces from `/fonts/`, which on the
    // gateway is the landing's public folder. Here it is the extension's root.
    "build:publicAssets": (_wxt, files) => {
      for (const name of ["inter-latin.woff2", "jetbrains-mono-latin.woff2"]) {
        files.push({ absoluteSrc: `${fonts}/${name}`, relativeDest: `fonts/${name}` });
      }
    },
  },
});
