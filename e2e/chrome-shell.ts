import type { Page } from "@playwright/test";

/**
 * A stand-in for Exeora for Chrome around its side panel.
 *
 * The panel only talks to an extension that frames it: it reads the
 * extension's origin from `location.ancestorOrigins` and posts its port
 * there. This page stands in for one: the panel's built entry is served
 * reading a `chrome-extension://` origin there, and this page takes the port
 * and answers the shell's requests (ready, a token for the mocked API). It
 * checks the panel's own behavior in a real browser, not the extension's.
 */

const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
export const SHELL_PATH = "/chrome-shell";

const SHELL_HTML = `<!doctype html>
<html>
  <body style="margin:0">
    <iframe allow="clipboard-read; clipboard-write" style="display:block;border:0;width:100vw;height:100vh"></iframe>
    <script>
      // The panel posts to the extension's origin; this page stands in for it.
      const post = window.postMessage.bind(window);
      window.postMessage = (message, _origin, transfer) => post(message, "*", transfer);
      window.addEventListener("message", (event) => {
        const port = event.ports && event.ports[0];
        if (!port || !event.data || event.data.kind !== "connect") return;
        port.onmessage = ({ data }) => {
          if (!data || data.exeora !== "panel" || typeof data.id !== "number") return;
          const kind = data.request && data.request.kind;
          const result =
            kind === "ready" ? { protocol: 1 } : kind === "token" ? { token: "e2e-token" } : {};
          port.postMessage({ exeora: "shell", id: data.id, ok: true, result });
        };
      });
      document.querySelector("iframe").src = "/dashboard/panel.html";
    </script>
  </body>
</html>`;

export async function openInChromeShell(page: Page) {
  // A frame's ancestor origins cannot be faked from a page, so the panel's
  // own entry is served reading this page as the extension that frames it.
  await page.route(/\/dashboard\/assets\/panel-[^/]+\.js$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /\.location\.ancestorOrigins\?\.\[0\]/,
      `.location.ancestorOrigins&&${JSON.stringify(EXTENSION)}`,
    );
    await route.fulfill({ response, body });
  });
  await page.route(`**${SHELL_PATH}`, (route) =>
    route.fulfill({ contentType: "text/html", body: SHELL_HTML }),
  );
  await page.goto(SHELL_PATH);
  return page.frameLocator("iframe");
}
