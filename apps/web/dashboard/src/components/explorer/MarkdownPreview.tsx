import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

/**
 * Markdown as a page. What `marked` makes of it goes through DOMPurify
 * before it reaches the DOM, since a file in a repository is anyone's.
 */
export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => {
    const rendered = marked.parse(source, { async: false, gfm: true, breaks: false });
    return DOMPurify.sanitize(typeof rendered === "string" ? rendered : "", {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "input", "button"],
    });
  }, [source]);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Sanitized above: the only markup here is what DOMPurify let through. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify */}
      <article className="markdown-preview px-5 py-4" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
