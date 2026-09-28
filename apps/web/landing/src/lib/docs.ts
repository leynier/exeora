/**
 * The documentation, grouped and in reading order.
 *
 * One list rather than a link in each page, so the sidebar, the mobile menu,
 * the previous/next pair and the order they imply cannot disagree with each
 * other. Adding a page means adding a line here and a file under `pages/docs/`.
 */
export const DOC_SECTIONS = [
  {
    title: "Get started",
    pages: [
      { href: "/docs/", label: "Getting started" },
      { href: "/docs/clients/", label: "Connecting a client" },
      { href: "/docs/projects/", label: "Projects, locations and workspaces" },
      { href: "/docs/github/", label: "Connecting GitHub" },
    ],
  },
  {
    title: "Use",
    pages: [
      { href: "/docs/tools/", label: "Tools" },
      { href: "/docs/agent-prompt/", label: "The agent prompt" },
      { href: "/docs/mcp-proxy/", label: "Proxy other MCP servers" },
      { href: "/docs/workspace/", label: "Source Control and terminal" },
      { href: "/docs/extension/", label: "Chrome extension" },
    ],
  },
  {
    title: "Control",
    pages: [
      { href: "/docs/policy/", label: "What a project allows" },
      { href: "/docs/security/", label: "Security" },
      { href: "/docs/plans/", label: "Plans and limits" },
    ],
  },
  {
    title: "Run",
    pages: [
      { href: "/docs/cloud/", label: "Exeora Cloud" },
      { href: "/docs/self-hosting/", label: "Self-hosting" },
    ],
  },
  {
    title: "Reference",
    pages: [
      { href: "/docs/cli/", label: "CLI reference" },
      { href: "/docs/troubleshooting/", label: "Troubleshooting" },
    ],
  },
] as const;

export type DocPage = (typeof DOC_SECTIONS)[number]["pages"][number];

/** Every page in reading order, for previous/next. */
export const DOC_PAGES: readonly DocPage[] = DOC_SECTIONS.flatMap((section) => section.pages);

/** The title of the group a page belongs to, for the eyebrow above its heading. */
export function docSection(href: string): string | undefined {
  return DOC_SECTIONS.find((section) => section.pages.some((page) => page.href === href))?.title;
}
