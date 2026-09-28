import { describe, expect, it } from "vitest";
import { headingText, outlineHtml, slugify } from "./doc-headings.js";

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Which URL")).toBe("which-url");
    expect(slugify("  exeora.toml ")).toBe("exeora-toml");
  });

  it("drops accents and falls back when nothing is left", () => {
    expect(slugify("Configuración")).toBe("configuracion");
    expect(slugify("…")).toBe("section");
  });
});

describe("headingText", () => {
  it("strips tags and decodes entities", () => {
    expect(headingText("<code>slug_taken</code> on <code>exeora&nbsp;add</code>")).toBe(
      "slug_taken on exeora add",
    );
    expect(headingText("A &amp; B")).toBe("A & B");
  });

  it("leaves no tag behind when tags are nested inside tags", () => {
    expect(headingText("<scr<script>ipt>alert(1)</script>")).not.toMatch(/[<>]/);
    expect(headingText("a <<b>b> c")).toBe("a b c");
  });
});

describe("outlineHtml", () => {
  it("keeps existing ids and generates the missing ones", () => {
    const { html, headings } = outlineHtml(
      '<h2 id="which-url">Which URL</h2><p>x</p><h2>Claude Code</h2><h3 class="a">Sub <code>gh</code></h3>',
    );

    expect(headings).toEqual([
      { id: "which-url", depth: 2, text: "Which URL", html: "Which URL" },
      { id: "claude-code", depth: 2, text: "Claude Code", html: "Claude Code" },
      { id: "sub-gh", depth: 3, text: "Sub gh", html: "Sub <code>gh</code>" },
    ]);
    expect(html).toContain('<h2 id="claude-code">Claude Code<a class="heading-anchor"');
    expect(html).toContain('<h3 id="sub-gh" class="a">');
    expect(html).toContain('href="#which-url"');
  });

  it("never reuses an id, including one a later heading already holds", () => {
    const { headings } = outlineHtml('<h2>Limits</h2><h2>Limits</h2><h2 id="limits-2">Other</h2>');
    expect(headings.map((heading) => heading.id)).toEqual(["limits", "limits-3", "limits-2"]);
  });

  it("ignores other heading levels", () => {
    const { headings, html } = outlineHtml("<h1>Title</h1><h4>Deep</h4>");
    expect(headings).toEqual([]);
    expect(html).toBe("<h1>Title</h1><h4>Deep</h4>");
  });
});
