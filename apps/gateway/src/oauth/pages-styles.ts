import tokens from "@exeora/design/tokens.css";

/**
 * The inline stylesheet the OAuth screens share.
 *
 * It lives apart from the markup because it is a 200-line CSS document that
 * happens to be written as a template literal: keeping it next to `pages.ts`
 * means the pages read as pages rather than as a stylesheet with three
 * functions appended to it.
 *
 * The CSS is inlined into every response rather than linked. A sign-in screen
 * should not wait on a second request to become legible, and this Worker has no
 * stylesheet build of its own. The fonts are the one exception: they are
 * subresources, so a slow one degrades to the system stack instead of blocking
 * the render.
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

export const styles = `
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

  /* What the token is for, named rather than left to the reader to infer. */
  .target {
    margin: 0 0 1.25rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .target div {
    display: flex;
    gap: .75rem;
    justify-content: space-between;
    padding: .55rem .8rem;
    font-size: .8125rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .target div:last-child { border-bottom: 0; }
  .target dt { color: var(--color-foreground-faint); }
  .target dd { margin: 0; text-align: right; overflow-wrap: anywhere; }

  /* A path is long enough that sharing a line with its label breaks it mid
     word, so it gets the full width underneath instead. */
  .target div.stack { flex-direction: column; gap: .15rem; }
  .target div.stack dd { text-align: left; font-size: .95em; }

  .reassure {
    margin: 0;
    color: var(--color-foreground-faint);
    font-size: .8125rem;
  }

  /* The account endpoint names no project, so the person names them here. The
     list is the access list: what is left unticked is what is taken away. */
  .picker {
    margin: 0 0 1.25rem;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .picker li { border-bottom: 1px solid var(--color-border-subtle); }
  .picker li:last-child { border-bottom: 0; }
  .picker label {
    display: flex;
    gap: .65rem;
    align-items: flex-start;
    padding: .6rem .8rem;
    cursor: pointer;
  }
  .picker input { margin-top: .2rem; flex: none; accent-color: var(--color-foreground); }
  .picker .who-what { min-width: 0; font-size: .8125rem; }
  .picker .name { display: block; }
  .picker .where {
    display: block;
    margin-top: .1rem;
    color: var(--color-foreground-faint);
    font-size: .9em;
    overflow-wrap: anywhere;
  }

  .empty {
    margin: 0 0 1.25rem;
    padding: .8rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    color: var(--color-foreground-faint);
    font-size: .8125rem;
  }

  .field { display: grid; gap: .4rem; margin: 0 0 1.25rem; }
  .field span { color: var(--color-foreground-faint); font-size: .8125rem; }
  .field input {
    font: inherit;
    font-family: var(--font-mono);
    font-size: 1.25rem;
    letter-spacing: .12em;
    text-transform: uppercase;
    padding: .7rem .85rem;
    color: var(--color-foreground);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
`;
