import type { Page } from "@playwright/test";
import { allowedPanelRoute } from "../apps/gateway/src/plugin-panel-routes.js";

/**
 * A stand-in for ChatGPT around the Workspace MCP App.
 *
 * It does what the gateway does to the resource (the `<base>` in place of the
 * marker, every root-relative URL made absolute) and frames the result the
 * way an MCP host does: `srcdoc` in a sandbox with an opaque origin, so web
 * storage throws and every asset is a CORS fetch. It answers `ui/*` over
 * `postMessage` and carries `exeora_panel_request` to the page's own `/api`,
 * where the dashboard specs' mocks answer it, after the gateway's own
 * allowlist: a route the panel may not reach is refused the way the gateway
 * refuses it, and logged.
 *
 * This is a mock host. It checks the panel's side of the protocol in a real
 * browser, not ChatGPT's behaviour.
 */

export interface HostScenario {
  context: Record<string, unknown>;
  /** The entrypoint's arguments and result, sent once the panel is initialized. */
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  /** Answers for the panel's own calls, in order, per tool. */
  tools?: Record<string, Record<string, unknown>[]>;
  /** Whether the host hands files over as resources (ChatGPT desktop). Defaults to true. */
  fileAccess?: boolean;
  /** Answer a request for fullscreen by staying inline. */
  declineFullscreen?: boolean;
}

export interface HostLog {
  calls: { name: string; arguments: Record<string, unknown> }[];
  links: string[];
  modes: string[];
  /** Panel requests the gateway's allowlist refused, as "METHOD /path". */
  refused: string[];
}

export const HOST_PATH = "/mcp-host";

export async function openInHost(page: Page, scenario: HostScenario) {
  // Static files the sandbox fetches cross-origin, as the gateway serves them.
  await page.route(/\/(dashboard\/assets|fonts)\//, async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "access-control-allow-origin": "*" },
      });
    } catch {
      // A lazy chunk still in flight when the test ends and closes the page.
    }
  });
  await page.route(`**${HOST_PATH}`, (route) =>
    route.fulfill({ contentType: "text/html", body: HOST_HTML }),
  );
  await page.exposeFunction("allowedPanelRoute", (path: string, method: string) =>
    allowedPanelRoute(path, method),
  );
  await page.addInitScript((value) => {
    (window as unknown as { scenario: HostScenario }).scenario = value;
  }, scenario);
  await page.goto(HOST_PATH);
  return page.frameLocator("iframe");
}

export function hostLog(page: Page): Promise<HostLog> {
  return page.evaluate(() => (window as unknown as { hostLog: HostLog }).hostLog);
}

/** A later call in the same thread: its arguments, then its result. */
export function callAgain(page: Page, input: Record<string, unknown>, result: unknown) {
  return page.evaluate(
    ([input, result]) =>
      (window as unknown as { callAgain: (input: unknown, result: unknown) => void }).callAgain(
        input,
        result,
      ),
    [input, result] as const,
  );
}

export const HOST_HTML = `<!doctype html>
<html>
  <body style="margin:0">
    <iframe sandbox="allow-scripts" style="display:block;border:0;width:100vw;height:100vh"></iframe>
    <script type="module">
      const scenario = window.scenario;
      const log = (window.hostLog = { calls: [], links: [], modes: [], refused: [] });
      const frame = document.querySelector("iframe");
      const queued = structuredClone(scenario.tools ?? {});
      let context = scenario.context;
      const send = (message) => frame.contentWindow.postMessage({ jsonrpc: "2.0", ...message }, "*");
      const reply = (id, result) => send({ id, result });

      async function callTool(name, args) {
        log.calls.push({ name, arguments: args });
        if (name === "exeora_panel_request") {
          const pathname = new URL(args.path, location.origin).pathname;
          if (!(await window.allowedPanelRoute(pathname, args.method))) {
            log.refused.push(args.method + " " + pathname);
            const message = "Open the Exeora dashboard to use this account feature.";
            return { content: [], structuredContent: { status: 403, body: { error: "forbidden", message } } };
          }
          const response = await fetch(args.path, {
            method: args.method,
            headers: args.body === undefined ? {} : { "Content-Type": "application/json" },
            body: args.body === undefined ? undefined : JSON.stringify(args.body),
          });
          const text = await response.text();
          return { content: [], structuredContent: { status: response.status, body: text ? JSON.parse(text) : null } };
        }
        const next = queued[name]?.shift();
        return next ?? { isError: true, content: [{ type: "text", text: "No answer for " + name }] };
      }

      window.addEventListener("message", async (event) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0" || !message.method) return;
        const { id, method, params } = message;
        if (method === "ui/initialize") {
          reply(id, {
            protocolVersion: params.protocolVersion,
            hostInfo: { name: "e2e-host", version: "1.0.0" },
            hostCapabilities: {
              openLinks: {},
              serverTools: {},
              experimental: scenario.fileAccess === false ? {} : { "openai/resource": {} },
            },
            hostContext: context,
          });
        } else if (method === "ui/notifications/initialized") {
          if (scenario.input) send({ method: "ui/notifications/tool-input", params: { arguments: scenario.input } });
          if (scenario.result) send({ method: "ui/notifications/tool-result", params: scenario.result });
        } else if (method === "tools/call") {
          reply(id, await callTool(params.name, params.arguments ?? {}));
        } else if (method === "ui/open-link") {
          log.links.push(params.url);
          reply(id, {});
        } else if (method === "ui/request-display-mode") {
          log.modes.push(params.mode);
          const mode = scenario.declineFullscreen ? context.displayMode : params.mode;
          context = { ...context, displayMode: mode };
          reply(id, { mode });
          send({ method: "ui/notifications/host-context-changed", params: { displayMode: mode } });
        } else if (id !== undefined) {
          reply(id, {});
        }
      });

      window.callAgain = (input, result) => {
        send({ method: "ui/notifications/tool-input", params: { arguments: input } });
        send({ method: "ui/notifications/tool-result", params: result });
      };

      const html = await (await fetch("/dashboard/mcp-panel.html")).text();
      const origin = location.origin;
      frame.srcdoc = html
        .replace("<!--exeora:base-->", '<base href="' + origin + '/dashboard/" target="_blank">')
        .replace(/(src|href)="\\/(?!\\/)/g, '$1="' + origin + "/");
    </script>
  </body>
</html>`;
