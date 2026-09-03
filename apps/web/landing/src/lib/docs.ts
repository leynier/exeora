/**
 * The documentation, in reading order.
 *
 * One list rather than a link in each page, so the sidebar, the previous/next
 * pair and the order they imply cannot disagree with each other. Adding a page
 * means adding a line here and a file under `pages/docs/`.
 */
export const DOC_PAGES = [
  { href: "/docs/", label: "Getting started" },
  { href: "/docs/clients/", label: "Connecting a client" },
  { href: "/docs/tools/", label: "Tools" },
  { href: "/docs/mcp-proxy/", label: "Proxy other MCP servers" },
  { href: "/docs/agent-prompt/", label: "The agent prompt" },
  { href: "/docs/policy/", label: "What a project allows" },
  { href: "/docs/workspace/", label: "Source Control and terminal" },
  { href: "/docs/cli/", label: "CLI reference" },
  { href: "/docs/plans/", label: "Plans and limits" },
  { href: "/docs/self-hosting/", label: "Self-hosting" },
  { href: "/docs/security/", label: "Security" },
  { href: "/docs/troubleshooting/", label: "Troubleshooting" },
] as const;
