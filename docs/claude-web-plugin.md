# Claude web plugin packaging and acceptance

This package targets **chat at claude.ai**, with Cowork and Claude Code as secondary consumers. It is independent of `plugins/exeora/`, its marketplace, archive and installation documentation. Claude's package lives in `plugins/exeora-claude/`; the repository marketplace is `.claude-plugin/marketplace.json`.

## Verified documentation (2026-10-11 UTC)

| Requirement | Decision and official evidence |
|---|---|
| Web installation | [Use plugins in Claude](https://support.claude.com/en/articles/13837440-use-plugins-in-claude) supports paid web chat. [Claude web overview](https://claude.com/docs/plugins/overview) explicitly documents Add > Upload plugin with `.zip` or `.plugin`, and Add > Add marketplace for repository URLs. A CLI installation stays on its machine; it does not install on the web account. |
| Manifest and components | [Web structure/testing](https://claude.com/docs/plugins/build) uses `.claude-plugin/plugin.json`, `skills/<name>/SKILL.md` and root `.mcp.json`. Each archive here has exactly one manifest at that path, three distinct skills and no folder wrapper. |
| Remote MCP | [Platform support](https://claude.com/docs/plugins/platform-support) accepts fixed-URL `http` or `sse` servers for chat. Local commands are ignored, URL references to user configuration are ignored, and `bin/` prevents installation. We use only `{ "type": "http", "url": "https://exeora.dev/mcp" }`. |
| OAuth on web | [Web structure/testing](https://claude.com/docs/plugins/build) says the user adds/connects the bundled connector in its Connectors tab and signs in through the server's OAuth flow. [Custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) describes detected auth and published client identity, automatic registration or a user-supplied OAuth client in the UI. Install alone neither adds the connector nor authenticates it. |
| OAuth fields | [Code MCP reference](https://code.claude.com/docs/en/mcp) documents `oauth.clientId`, `callbackPort`, `authServerMetadataUrl` and `scopes` for Code. No reviewed web plugin source establishes those as web controls. Omit them, all credentials and custom authorization headers; use discovery and the user's explicit consent. |
| Metadata/assets | [Manifest reference](https://code.claude.com/docs/en/plugins-reference) documents `displayName`, author/version/license and directory listing `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl`. The icon is a bundled relative PNG. These fields do not prove how Claude displays custom uploads, nor establish a directory listing. |
| Upload limits | [Plugins API](https://platform.claude.com/docs/en/manage-claude/plugins-api) specifies one manifest, YAML skill name/description without XML, 64-character name/displayName, 500-character description, 200 MB, 5,000 files, safe relative paths, no symlinks/encryption/nested ZIPs, STORE or DEFLATE. Our narrow allowlist and deterministic DEFLATE writer stay within these limits. The archive includes README and LICENSE. |
| API/publication | The Plugins API is an organization-management API with scoped keys and organization marketplaces. It is separate from Messages API and personal upload. No organization API writes, permission changes or directory submissions are part of this implementation. |

Read-only public discovery checks during development returned `https://exeora.dev/.well-known/oauth-protected-resource/mcp` with resource `https://exeora.dev/mcp`, authorization server `https://exeora.dev` and scopes `tools:read tools:execute`. The authorization server metadata advertised `/oauth/authorize`, `/oauth/token`, `/oauth/register`, PKCE `S256`, authorization-code/refresh-token grants and `client_id_metadata_document_supported: true`. These GETs establish discovery availability only. They did not register a client, create a grant, exchange tokens or verify compatibility of a real Claude account flow.

## Build and delivery

`bun run plugin:build:claude` produces two names for identical archive bytes: `exeora-claude.plugin` and `exeora-claude-plugin.zip`, each with a filename-specific SHA-256 sidecar, plus `exeora-claude-plugin.json`. Every landing build generates both this package and the existing ChatGPT package independently. The static gateway serves `/downloads/`; no separate release or tag is required. Generated files are ignored in Git. Bump the Claude manifest version for future package releases.

Tests verify archive contents and reproducibility, reject credential-bearing MCP configuration, unknown manifest fields, unsafe resources and symlinks, and check both downloads, digests and metadata through the real static assets binding. The ChatGPT version 1.0.0 checksum remains `7f289d690baacd71b1dd8c17a6d0e7602877e248517f78601e1815406aa9cb97`. Browser tests exercise the actual download link at desktop and narrow widths. CLI validation is supplementary syntax validation, without installation or authentication.

## Manual Claude web acceptance, still unverified

1. In a paid Claude web test account where policy permits uploads, use **Customize > Plugins > Add > Upload plugin** with either generated archive. Confirm the three skills appear and the fixed Exeora connector is listed. Do not use a Code CLI install as evidence.
2. Complete connector setup only with the account owner's explicit authorization to create a real connection/grant. On Team/Enterprise an Owner adds the connector first. Sign in through OAuth, select intended projects and enable the connector for a conversation. Confirm a successful `list_projects` and `list_workspaces` response; do not grant persistent **Always allow** permissions for this test.
3. Verify the icon's actual presentation and any MCP App rendering in Claude web independently. The skill must still work through read tools and dashboard links when interactive UI is unavailable. Code's manifest parser, repository tests and a successful MCP response cannot prove a rendered web view.

This task does not perform those persistent account changes. No live Claude web installation, real OAuth, automatic updates from the repository, organization distribution or public-directory approval is claimed. The user-facing instructions describe the documented paths and these limits.
