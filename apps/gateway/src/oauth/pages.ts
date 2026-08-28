import type { ClientInfo } from "@cloudflare/workers-oauth-provider";
import { html, raw } from "hono/html";
import { styles } from "./pages-styles.js";
import type { UpstreamProvider } from "./providers/index.js";
import type { AccountTargetProject, AuthTarget } from "./target.js";

/**
 * The only HTML the gateway serves. The landing page and dashboard live in
 * `apps/web`; these screens stay here because they are part of the OAuth
 * flow and must be served by the authorization server itself.
 *
 * The stylesheet they share is in `pages-styles.ts` and inlined by `layout`.
 */

/**
 * The wordmark, matching the landing's: three tiles, one above and two below.
 *
 * Same three numbers everywhere it is drawn: 24 wide on a pitch of 20, radius
 * 4, so the overlap equals the radius and the silhouette closes.
 */
const mark = html`<svg
  viewBox="0 0 64 44"
  width="22"
  height="15"
  fill="currentColor"
  aria-hidden="true"
  xmlns="http://www.w3.org/2000/svg"
>
  <rect x="20" y="0" width="24" height="24" rx="4" />
  <rect x="0" y="20" width="24" height="24" rx="4" />
  <rect x="40" y="20" width="24" height="24" rx="4" />
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
  google: html`<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
    <path
      fill="#4285f4"
      d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615Z"
    />
    <path
      fill="#34a853"
      d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.329-1.585-5.036-3.711H.957v2.333C2.438 15.983 5.482 18 9 18Z"
    />
    <path
      fill="#fbbc05"
      d="M3.964 10.71A5.42 5.42 0 0 1 3.682 9c0-.595.102-1.17.282-1.71V4.957H.957A9 9 0 0 0 0 9c0 1.451.347 2.827.957 4.043l3.007-2.333Z"
    />
    <path
      fill="#ea4335"
      d="M9 3.579c1.321 0 2.508.454 3.442 1.346l2.581-2.581C13.464.892 11.426 0 9 0 5.482 0 2.438 2.017.957 4.957L3.964 7.29C4.671 5.164 6.656 3.579 9 3.579Z"
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

        <p class="reassure" style="margin-top:1.25rem">
          Sign-in only proves who you are. Exeora reads your name, email address and avatar, and
          nothing else. It cannot see your repositories or your code.
        </p>
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
  /** The project this token will be bound to, when the request named one. */
  target?: AuthTarget | null;
}) {
  const name = options.client?.clientName ?? options.client?.clientId ?? "An application";
  const { target } = options;

  return layout(
    "Authorize",
    html`
      <div class="card">
        <h1>Authorize ${name}</h1>
        <p class="lede">
          ${
            target
              ? html`It is asking for access to one project on one of your machines.`
              : html`It is asking for access to the projects you have connected to Exeora.`
          }
        </p>

        <p class="who"><span class="dot"></span> Signed in as ${options.userEmail}</p>

        ${
          target
            ? html`<dl class="target">
              <div><dt>Project</dt><dd>${target.project}</dd></div>
              <div><dt>Machine</dt><dd>${target.machine}</dd></div>
              <div class="stack"><dt>Directory</dt><dd><code>${target.localPath}</code></dd></div>
            </dl>`
            : ""
        }

        <div class="warn">
          This grants <strong>${name}</strong> the ability to read, edit and run commands in
          ${target ? html`that directory` : html`the project you connect it to`}, on
          ${target ? html`${target.machine}` : html`whichever machine is serving it`}. Commands are
          not filtered. Only approve applications you trust.
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

/**
 * The consent screen for the account endpoint, `exeora.dev/mcp`.
 *
 * Its own function rather than a branch inside `consentPage`, because it asks a
 * different question. The per-project screen states what the token is for and
 * takes yes or no; this one has to be answered, since `/mcp` names no project
 * and an unanswered screen would either grant everything or nothing.
 *
 * The tick boxes are the access list, not a way to add to one: they arrive
 * ticked for whatever this client already reaches through this endpoint, and
 * unticking one revokes it. Access granted through a project's own URL is a
 * separate consent and never appears here, so nothing this screen was not asked
 * about can be taken away by it.
 */
export function accountConsentPage(options: {
  client: ClientInfo | null;
  userEmail: string;
  state: string;
  scopes: string[];
  projects: AccountTargetProject[];
  /** Shown when a previous submission could not be accepted as it stood. */
  problem?: string;
}) {
  const name = options.client?.clientName ?? options.client?.clientId ?? "An application";
  const { projects } = options;

  return layout(
    "Authorize",
    html`
      <div class="card">
        <h1>Authorize ${name}</h1>
        <p class="lede">
          It is asking for one connection covering several projects. Choose which ones it may
          reach.
        </p>

        <p class="who"><span class="dot"></span> Signed in as ${options.userEmail}</p>

        ${options.problem ? html`<div class="warn">${options.problem}</div>` : ""}

        ${
          projects.length === 0
            ? html`<p class="empty">
                You have not connected any projects yet. Run <code>exeora project add</code> in a
                directory on a machine running <code>exeora connect</code>, then authorize this application again.
              </p>
              <form method="post" action="/oauth/approve">
                <input type="hidden" name="state" value="${options.state}" />
                <button class="btn secondary" type="submit" name="decision" value="deny">
                  Cancel
                </button>
              </form>`
            : html`<form method="post" action="/oauth/approve">
              <input type="hidden" name="state" value="${options.state}" />

              <ul class="picker">
                ${projects.map(
                  (project) => html`<li>
                    <label>
                      <input
                        type="checkbox"
                        name="project"
                        value="${project.id}"
                        ${project.granted ? raw("checked") : ""}
                      />
                      <span class="who-what">
                        <span class="name">${project.project}</span>
                        <span class="where"
                          >${project.machine} · <code>${project.localPath}</code></span
                        >
                      </span>
                    </label>
                  </li>`,
                )}
              </ul>

              <div class="warn">
                This grants <strong>${name}</strong> the ability to read, edit and run commands in
                every project you tick, on the machine serving it. It chooses which of them to work
                in, one at a time. Commands are not filtered. Only approve applications you trust.
              </div>

              ${
                options.scopes.length > 0
                  ? html`<ul class="scopes">
                    ${options.scopes.map((scope) => html`<li><code>${scope}</code></li>`)}
                  </ul>`
                  : ""
              }

              <button class="btn" type="submit" name="decision" value="approve">Authorize</button>
              <button class="btn secondary" type="submit" name="decision" value="deny">
                Cancel
              </button>
            </form>`
        }
      </div>

      <p class="foot">You can change which projects it reaches, or revoke it, from the dashboard.</p>
    `,
  );
}

/**
 * The CLI is waiting on another machine. The person types the code shown in
 * the terminal. The form is never prefilled from the URL: a link that already
 * carried the code would be how a phishing page signed someone else's CLI in.
 */
export function deviceCodePage(options: { userCode?: string; problem?: string } = {}) {
  const prefilled = options.userCode ?? "";
  return layout(
    "Sign in from another device",
    html`
      <div class="card">
        <h1>Sign in from another device</h1>
        <p class="lede">
          Enter the code shown in the terminal running <code>exeora login --code</code>.
        </p>

        <div class="warn">
          Only enter a code displayed on a terminal you control. A code from a chat, an email or
          another website would sign <em>their</em> machine in as you.
        </div>

        ${options.problem ? html`<div class="warn">${options.problem}</div>` : ""}

        <form method="post" action="/oauth/device">
          <label class="field">
            <span>Code</span>
            <input
              type="text"
              name="user_code"
              value="${prefilled}"
              autocomplete="one-time-code"
              autocapitalize="characters"
              spellcheck="false"
              inputmode="text"
              maxlength="9"
              required
            />
          </label>
          <button class="btn" type="submit">Continue</button>
        </form>
      </div>

      <p class="foot">The code expires in ten minutes and can be used only once.</p>
    `,
  );
}

export function deviceDonePage(outcome: "authorized" | "denied") {
  const authorized = outcome === "authorized";
  return layout(
    authorized ? "Signed in" : "Sign-in cancelled",
    html`
      <div class="card">
        <h1>${authorized ? "Signed in" : "Sign-in cancelled"}</h1>
        <p class="lede">
          ${
            authorized
              ? "You can close this tab and return to the terminal."
              : "The terminal will stop waiting. Run the command again if you still want to sign in."
          }
        </p>
      </div>
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
