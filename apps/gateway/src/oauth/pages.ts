import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import { html, raw } from "hono/html";
import type { UpstreamProvider } from "./providers/index.js";

/**
 * The only HTML the gateway serves. The landing page and dashboard live in
 * `apps/web`; these two screens stay here because they are part of the OAuth
 * flow and must be served by the authorization server itself.
 */

const styles = `
  :root { color-scheme: light dark; --fg:#111; --muted:#666; --bg:#fff; --line:#e5e5e5; --accent:#111; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#f5f5f5; --muted:#a1a1a1; --bg:#0d0d0d; --line:#262626; --accent:#f5f5f5; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:1.5rem;
    background:var(--bg); color:var(--fg);
    font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { width:100%; max-width:26rem; }
  h1 { font-size:1.25rem; margin:0 0 .35rem; letter-spacing:-.01em; }
  p { margin:0 0 1.25rem; color:var(--muted); font-size:.9rem; }
  ul { margin:0 0 1.25rem; padding:0; list-style:none; border:1px solid var(--line); border-radius:.6rem; }
  li { padding:.6rem .8rem; font-size:.85rem; border-bottom:1px solid var(--line); }
  li:last-child { border-bottom:0; }
  code { font:.85em ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--fg); }
  .btn { display:block; width:100%; padding:.7rem 1rem; border:0; border-radius:.6rem; cursor:pointer;
    background:var(--accent); color:var(--bg); font:inherit; font-weight:600; font-size:.9rem;
    text-align:center; text-decoration:none; }
  .btn.secondary { background:transparent; color:var(--muted); border:1px solid var(--line);
    font-weight:400; margin-top:.5rem; }
  .brand { font-weight:600; letter-spacing:-.02em; margin-bottom:1.75rem; display:block; }
  .warn { border:1px solid var(--line); border-radius:.6rem; padding:.8rem;
    font-size:.85rem; color:var(--muted); margin-bottom:1.25rem; }
`;

function layout(title: string, body: ReturnType<typeof html>) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title} · Exeora</title>
        <style>
          ${raw(styles)}
        </style>
      </head>
      <body>
        <main>
          <span class="brand">Exeora</span>
          ${body}
        </main>
      </body>
    </html>`;
}

export function signInPage(providers: UpstreamProvider[], state: string) {
  return layout(
    "Sign in",
    html`
      <h1>Sign in to continue</h1>
      <p>An application is asking to connect to your local development environment.</p>
      ${providers.map(
        (provider) =>
          html`<a class="btn" href="/oauth/login/${provider.id}?state=${state}"
            >Continue with ${provider.label}</a
          >`,
      )}
    `,
  );
}

export function consentPage(options: {
  client: ClientInfo | null;
  userEmail: string;
  state: string;
  scopes: string[];
}) {
  const name = options.client?.clientName ?? options.client?.clientId ?? "An application";

  return layout(
    "Authorize",
    html`
      <h1>Authorize ${name}</h1>
      <p>Signed in as ${options.userEmail}.</p>

      <div class="warn">
        This grants ${name} the ability to read, edit and run commands in the project you connect
        it to — on your own machine. Only approve applications you trust.
      </div>

      ${
        options.scopes.length > 0
          ? html`<ul>
            ${options.scopes.map((scope) => html`<li><code>${scope}</code></li>`)}
          </ul>`
          : ""
      }

      <form method="post" action="/oauth/approve">
        <input type="hidden" name="state" value="${options.state}" />
        <button class="btn" type="submit" name="decision" value="approve">Authorize</button>
        <button class="btn secondary" type="submit" name="decision" value="deny">Cancel</button>
      </form>
    `,
  );
}

export function errorPage(message: string) {
  return layout(
    "Something went wrong",
    html`
      <h1>Something went wrong</h1>
      <p>${message}</p>
      <a class="btn secondary" href="/">Back to Exeora</a>
    `,
  );
}
