import { Hono } from "hono";
import windowsInstaller from "../../../install.ps1";
import unixInstaller from "../../../install.sh";

/** Stable, same-origin installer URLs used by the website and upgrade docs. */
export const installers = new Hono();

const headers = {
  "cache-control": "public, max-age=300",
  "x-content-type-options": "nosniff",
};

installers.get("/linux/install.sh", (context) =>
  context.body(unixInstaller, 200, {
    ...headers,
    "content-type": "text/x-shellscript; charset=utf-8",
  }),
);

installers.get("/macos/install.sh", (context) =>
  context.body(unixInstaller, 200, {
    ...headers,
    "content-type": "text/x-shellscript; charset=utf-8",
  }),
);

installers.get("/windows/install.ps1", (context) =>
  context.body(windowsInstaller, 200, {
    ...headers,
    "content-type": "text/plain; charset=utf-8",
  }),
);
