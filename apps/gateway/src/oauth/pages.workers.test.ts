import { describe, expect, it } from "vitest";
import { consentPage, errorPage, signInPage } from "./pages.js";
import { github } from "./providers/github.js";
import { google } from "./providers/google.js";

/**
 * The authorization screens, rendered.
 *
 * These run under workerd rather than in the node project because `pages.ts`
 * imports the shared tokens as a Text module, which only the Worker bundler
 * and the workers pool know how to load.
 *
 * The tokens assertions are not cosmetic. The stylesheet is inlined by
 * rewriting `@theme` to `:root`, and when that rewrite silently misses, every
 * screen still renders and still returns 200 while looking like an unstyled
 * document. Nothing else in the suite would notice.
 */

const render = (page: ReturnType<typeof errorPage>) => page.toString();

/**
 * The same HTML with runs of whitespace collapsed, for asserting on a sentence
 * the browser will render as one line. Without it, rewrapping the source
 * splits a phrase across lines and fails a test that nothing has broken.
 */
const text = (page: ReturnType<typeof errorPage>) => render(page).replace(/\s+/g, " ");

function styleBlock(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  if (match === undefined) throw new Error("the page rendered no <style> block");
  return match.trim();
}

describe("the inlined stylesheet", () => {
  const css = styleBlock(render(signInPage([github], "state-1")));

  // Asserting on substrings alone is not enough here, and the reason is worth
  // writing down: when the `@theme` rewrite goes wrong it tends to leave an
  // unterminated comment, so `--color-bg:` and `:root {` are both still
  // present as text while every declaration sits inside a comment or outside
  // any selector, and the browser drops the lot. These assert on structure.

  it("opens with the token block, not with anything the browser would skip", () => {
    expect(css.startsWith(":root {")).toBe(true);
  });

  it("defines the tokens the rest of the sheet reads, inside that block", () => {
    const rootBlock = css.slice(0, css.indexOf("}") + 1);

    // A comment inside the block is how a bad rewrite hides the declarations
    // that follow it, so the block has to be free of them.
    expect(rootBlock).not.toContain("/*");

    for (const token of ["--color-bg", "--color-surface", "--color-border", "--font-sans"]) {
      expect(rootBlock).toContain(`${token}:`);
    }
  });

  it("leaves no Tailwind at-rule behind", () => {
    expect(css).not.toContain("@theme");
  });
});

describe("sign in", () => {
  it("offers one button per configured provider, carrying its state", async () => {
    const html = render(signInPage([github, google], "state-1"));

    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("/oauth/login/github?state=state-1");
    expect(html).toContain("Continue with Google");
    expect(html).toContain("/oauth/login/google?state=state-1");
  });
});

describe("consent", () => {
  const base = {
    client: { clientId: "cli_1", clientName: "Claude" } as never,
    userEmail: "you@example.com",
    state: "state-1",
    scopes: ["tools:read", "tools:execute"],
  };

  it("names the client, the account and every scope", async () => {
    const html = render(consentPage(base));

    expect(html).toContain("Authorize Claude");
    expect(html).toContain("you@example.com");
    expect(html).toContain("tools:read");
    expect(html).toContain("tools:execute");
  });

  it("says plainly that commands are not filtered", async () => {
    // The one sentence on this screen that must not quietly disappear in a
    // redesign: it is the only warning a user gets before granting execution.
    expect(text(consentPage(base))).toContain("Commands are not filtered");
  });

  it("posts both decisions to the approval endpoint", async () => {
    const html = render(consentPage(base));

    expect(html).toContain('action="/oauth/approve"');
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="deny"');
  });

  it("escapes a client name rather than rendering it as markup", async () => {
    const html = render(
      consentPage({ ...base, client: { clientName: "<img src=x onerror=alert(1)>" } as never }),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("falls back to the client id, then to a generic name", async () => {
    expect(render(consentPage({ ...base, client: { clientId: "cli_9" } as never }))).toContain(
      "Authorize cli_9",
    );
    expect(render(consentPage({ ...base, client: null }))).toContain("Authorize An application");
  });
});

describe("errors", () => {
  it("shows the message and a way back", async () => {
    const html = render(errorPage("This sign-in link has expired."));

    expect(html).toContain("This sign-in link has expired.");
    expect(html).toContain('href="/"');
  });

  it("keeps every screen out of search results", async () => {
    for (const page of [signInPage([github], "s"), errorPage("nope")]) {
      expect(render(page)).toContain('name="robots" content="noindex"');
    }
  });
});
