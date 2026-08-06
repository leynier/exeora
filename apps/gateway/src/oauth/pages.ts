import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import tokens from "@exeora/design/tokens.css";
import { html, raw } from "hono/html";
import type { UpstreamProvider } from "./providers/index.js";

/**
 * The only HTML the gateway serves. The landing page and dashboard live in
 * `apps/web`; these three screens stay here because they are part of the OAuth
 * flow and must be served by the authorization server itself.
 *
 * Their CSS is inlined rather than linked. A sign-in screen should not wait on
 * a second request to become legible, and this Worker has no stylesheet build
 * of its own. The fonts are the one exception: they are subresources, so a
 * slow one degrades to the system stack instead of blocking the render.
 */

/**
 * The shared tokens, as a `:root` block.
 *
 * They arrive as a Text module (see `rules` in wrangler.jsonc). `@theme` is a
 * Tailwind at-rule that a browser would discard along with everything inside
 * it, but its body is exactly the custom-property declarations these pages
 * want, so the wrapper becomes the `:root` Tailwind itself would have emitted.
 *
 * Comments are stripped first, for two reasons: they are dead weight on every
 * sign-in page, and tokens.css talks about `@theme` in its own header, which a
 * naive replacement matches instead of the block.
 */
const tokenVars = tokens
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@theme[^{]*\{/, ":root {")
  .trim();

// A silent miss here ships unstyled authorization screens, which is worse than
// a Worker that refuses to start. The tests import this module, so CI sees it.
if (!tokenVars.startsWith(":root")) {
  throw new Error("@exeora/design/tokens.css no longer opens with an @theme block");
}

const styles = `
  ${tokenVars}

  @font-face {
    font-family: "Inter";
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url(/fonts/inter-latin.woff2) format("woff2-variations");
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: var(--color-bg);
    color: var(--color-foreground);
    font: 15px/1.6 var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }

  /* The same breathing wash the landing puts behind its hero, so arriving
     here from exeora.dev does not feel like a different product. */
  body::before {
    content: "";
    position: fixed;
    inset: 0 0 auto 0;
    height: 28rem;
    pointer-events: none;
    background: radial-gradient(
      ellipse 75% 55% at 50% -8%,
      rgba(79, 209, 197, 0.07) 0%,
      rgba(236, 236, 236, 0.03) 35%,
      transparent 70%
    );
  }

  main { position: relative; width: 100%; max-width: 25rem; }

  .brand {
    display: flex;
    align-items: center;
    gap: .5rem;
    justify-content: center;
    margin-bottom: 1.5rem;
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -.02em;
  }
  .brand svg { color: var(--color-brand); }

  .card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-surface);
    padding: 1.75rem;
  }

  h1 { margin: 0 0 .4rem; font-size: 1.125rem; font-weight: 600; letter-spacing: -.02em; }
  .lede { margin: 0 0 1.5rem; color: var(--color-foreground-muted); font-size: .875rem; }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: .55rem;
    width: 100%;
    padding: .7rem 1rem;
    border: 0;
    border-radius: var(--radius-lg);
    cursor: pointer;
    background: var(--color-accent);
    color: var(--color-on-accent);
    font: inherit;
    font-weight: 600;
    font-size: .875rem;
    text-align: center;
    text-decoration: none;
    transition: background var(--transition-duration-fast);
  }
  .btn:hover { background: var(--color-foreground); }
  .btn + .btn { margin-top: .5rem; }

  .btn.secondary {
    background: transparent;
    color: var(--color-foreground-muted);
    border: 1px solid var(--color-border);
    font-weight: 500;
  }
  .btn.secondary:hover { background: var(--color-surface-variant); color: var(--color-foreground); }

  /* The consent warning is the one thing on the page that should not read as
     boilerplate, so it borrows the landing's warning accent rather than
     another grey box. */
  .warn {
    border: 1px solid color-mix(in srgb, var(--color-warning) 35%, transparent);
    background: color-mix(in srgb, var(--color-warning) 4%, transparent);
    border-radius: var(--radius-lg);
    padding: .85rem 1rem;
    margin-bottom: 1.25rem;
    color: var(--color-foreground-muted);
    font-size: .8125rem;
  }
  .warn strong { color: var(--color-foreground); font-weight: 600; }

  .who {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin: 0 0 1.25rem;
    color: var(--color-foreground-faint);
    font-size: .8125rem;
  }
  .who .dot {
    width: .375rem; height: .375rem; border-radius: 999px;
    background: var(--color-success); flex: none;
  }

  .scopes {
    margin: 0 0 1.25rem;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .scopes li {
    padding: .55rem .8rem;
    font-size: .8125rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .scopes li:last-child { border-bottom: 0; }

  code { font-family: var(--font-mono); font-size: .9em; color: var(--color-foreground); }

  .foot {
    margin: 1.25rem 0 0;
    text-align: center;
    color: var(--color-foreground-faint);
    font-size: .75rem;
  }
`;

/** The wordmark, matching the landing's: a half-lit circle. */
const mark = html`<svg
  viewBox="0 0 64 64"
  width="18"
  height="18"
  fill="none"
  aria-hidden="true"
  xmlns="http://www.w3.org/2000/svg"
>
  <circle cx="32" cy="32" r="17" stroke="currentColor" stroke-width="5" />
  <path d="M32 15a17 17 0 0 0 0 34z" fill="currentColor" />
</svg>`;

/**
 * Provider marks, keyed by the same id the provider registry uses, so adding
 * Google is a new entry here and nothing else on this page.
 */
const PROVIDER_MARKS: Record<string, ReturnType<typeof html> | undefined> = {
  github: html`<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"
    />
  </svg>`,
};

function layout(title: string, body: ReturnType<typeof html>) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0d0f11" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <title>${title} · Exeora</title>
        <style>
          ${raw(styles)}
        </style>
      </head>
      <body>
        <main>
          <span class="brand">${mark} Exeora</span>
          ${body}
        </main>
      </body>
    </html>`;
}

export function signInPage(providers: UpstreamProvider[], state: string) {
  return layout(
    "Sign in",
    html`
      <div class="card">
        <h1>Sign in to continue</h1>
        <p class="lede">
          An application is asking to connect to the development environment on one of your machines.
        </p>

        ${providers.map(
          (provider) =>
            html`<a class="btn" href="/oauth/login/${provider.id}?state=${state}">
              ${PROVIDER_MARKS[provider.id] ?? ""} Continue with ${provider.label}
            </a>`,
        )}
      </div>

      <p class="foot">You will be asked to approve the application on the next screen.</p>
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
      <div class="card">
        <h1>Authorize ${name}</h1>
        <p class="lede">
          It is asking for access to the projects you have connected to Exeora.
        </p>

        <p class="who"><span class="dot"></span> Signed in as ${options.userEmail}</p>

        <div class="warn">
          This grants <strong>${name}</strong> the ability to read, edit and run commands in the
          project you connect it to, on whichever machine is serving it. Commands are not
          filtered. Only approve applications you trust.
        </div>

        ${
          options.scopes.length > 0
            ? html`<ul class="scopes">
              ${options.scopes.map((scope) => html`<li><code>${scope}</code></li>`)}
            </ul>`
            : ""
        }

        <form method="post" action="/oauth/approve">
          <input type="hidden" name="state" value="${options.state}" />
          <button class="btn" type="submit" name="decision" value="approve">Authorize</button>
          <button class="btn secondary" type="submit" name="decision" value="deny">Cancel</button>
        </form>
      </div>

      <p class="foot">You can revoke this at any time from the dashboard.</p>
    `,
  );
}

export function errorPage(message: string) {
  return layout(
    "Something went wrong",
    html`
      <div class="card">
        <h1>Something went wrong</h1>
        <p class="lede">${message}</p>
        <a class="btn secondary" href="/">Back to Exeora</a>
      </div>
    `,
  );
}
