# Exeora plugin distributions

Verified against official documentation on 2026-10-11 UTC. This continuation preserves the released ChatGPT package and the independent Claude web package, and adds three independent distributions. Each source folder owns its version and instructions; the landing build produces all five downloads, metadata and SHA-256 sidecars. Generated artifacts are ignored and rebuilt on deployment rather than attached to the unrelated CLI release pipeline.

| Visible channel | Source and format | Distribution and documented installation |
| --- | --- | --- |
| ChatGPT | `plugins/exeora`, Agent Plugins with `com.openai` | Existing ZIP and OpenAI catalog unchanged. |
| Claude web | `plugins/exeora-claude`, `.claude-plugin/plugin.json`, `.mcp.json` | ZIP/`.plugin` web upload and explicit connector add/connect. See [Claude acceptance](claude-web-plugin.md). |
| GrokBot Cursor | `plugins/exeora-cursor`, `.cursor-plugin/plugin.json`, `mcp.json` | ZIP extracted into Cursor's allowed local plugin folder; independent root Cursor repository catalog. Grok Bot documents catalog add/auth only. |
| Agent Plugin | `plugins/exeora-agent`, root standard `plugin.json`/`mcp.json` | Pure Agent Plugins 1.0.0, no provider extensions or directories. Import/loading is client-defined. |
| GitHub Copilot | `plugins/exeora-copilot`, Agent Plugins 1.0.0 with adapted skills | Extracted directory/repository CLI install; `.github/plugin/marketplace.json` for app/VS Code repository distribution. |

## ChatGPT web distribution

The preserved OpenAI ZIP and the actual sent mixed ZIP declare remote MCP. [OpenAI classifies imported MCP plugins as Desktop only](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins), regardless of HTTPS transport. Public web use without each user registering a URL follows the publisher submission, MCP connection/domain verification, scans, review and approval/publication path. [The distribution guide](chatgpt-plugin-distribution.md) records archive evidence, `.app.json` limitations, local preparation and external blockers. Private owner connections are not a universal solution.

## Cursor and Grok Bot decisions

The [Cursor reference](https://cursor.com/docs/reference/plugins) documents the Cursor manifest, fixed skill/MCP discovery, relative `logo` and repository marketplace. The [official template](https://github.com/cursor/plugin-template/tree/46216072ac5750f782f95bb325b4d12b7c3ae9c9) uses `displayName`, although the reference's field table currently omits it. We use that template field for the exact visible name `GrokBot Cursor`; the identifier remains `grokbot-cursor`. The supplied image is Exeora's existing mark, not a provider logo.

The [Cursor installation guide](https://cursor.com/docs/plugins) supports copying a plugin to `~/.cursor/plugins/local/<identifier>` and reloading, subject to existing organization policy. An existing marketplace install takes precedence. The [Grok Bot guide](https://cursor.com/help/grok-bot/connect-plugins) describes Plugins > search/add > provider authorization > Installed. It does not document importing a custom ZIP, local plugin directory or arbitrary repository into Grok Bot. The package and instructions are prepared for both intended audiences, but Grok Bot catalog ingestion, Exeora availability and skill loading remain unverified; sharing an account is insufficient evidence.

The [Cursor MCP guide](https://cursor.com/docs/mcp) documents remote URL configuration and dynamic registration, plus optional static `auth` client credentials. The package contains only the fixed public URL. It does not configure static credentials, callbacks or organization settings.

## Pure Agent Plugins 1.0.0

The [normative specification](https://agent-plugins.org/specification) and [official schemas](https://agent-plugins.org/schemas) require the canonical manifest/MCP schema identifiers and fixed component locations. The remote transport is `streamable-http`; authentication is client-managed. The pure ZIP contains only the two standard JSON documents, three immediate-child skills, README and LICENSE. The visible channel label is outside the ZIP manifest; the identifier is `exeora-agent-plugin`. There are no provider fields, namespaces, assets or alternate manifests.

The schema copies under `scripts/schemas/agent-plugins-1.0.0/` are validated with Ajv's Draft 2020-12 implementation at build time without fetching while loading. Distribution checks additionally reject all extensions, unrecognized resources, symlinks and any alteration of the credential-free remote configuration. Skills use the two required [Agent Skills](https://agentskills.io/specification) fields and preserve user scope, selector routing, existing changes and server-policy handling without naming a client interface.

## GitHub Copilot decisions and image investigation

[GitHub's concepts](https://docs.github.com/en/copilot/concepts/agents/about-plugins) support plugins in Copilot CLI, cloud agent and the GitHub Copilot app. The [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) recommends the standard format for new packages and documents the `com.github.copilot` component namespace. No namespace extension is needed for this package's three skills and remote MCP, so none is invented. CLI discovery checks `.github/plugin/marketplace.json` before the existing Claude catalog, which keeps the Copilot entry independent.

The [app customization guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app) documents Customize > Plugins and adding a repository marketplace. The [VS Code guide](https://code.visualstudio.com/docs/agent-customization/agent-plugins) explicitly supports Agent Plugins, marketplace installation and discovery of CLI-installed packages. These are supported setup paths, not observations of installation. GitHub Copilot is distinct from Microsoft 365 Copilot.

The reviewed GitHub CLI field tables, [authoring guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) and VS Code guide define no plugin `logo`, `icon` or `interface` metadata. They define namespace components and automation data, which do not establish image support. Consequently the Copilot PNG is an ordinary README asset and website image only, with no catalog-rendering claim or unsupported extension object. This is a limit of the reviewed documentation, not proof that every internal host implementation rejects images.

## Acceptance and remaining limits

Automated checks cover deterministic archives, official JSON Schema validation, exclusion of provider extensions in the pure package, rejected secrets/native configuration, marketplace mapping, checksums, real gateway Static Assets downloads including 304 responses, responsive browser downloads and preservation of ChatGPT/Claude bytes. Cursor's official template validator is supplementary structural evidence; Claude Code validation is syntax evidence only.

No package was installed into a user account or local host configuration by this agent. The user reports preliminary Claude web import/use success for one of three unidentified experimental ZIPs; that does not verify every archive or real OAuth. No public directory submission, marketplace review/publication or organization upload was performed. Real OAuth, host skill execution, interactive UI and per-surface discovery remain unverified. Public Exeora metadata advertises dynamic registration and PKCE; read-only metadata success does not prove a client authorization exchange. No credentials, grants, persistent permissions or managed policies are changed.

Manual acceptance must be separate for Claude web, Cursor, a compatible generic client, and each intended Copilot surface: install through its documented path, inspect the expected skills/MCP, authorize Exeora through the host, then get a successful `list_projects` response. For Grok Bot, first establish an officially supported ingestion/catalog path and actual listing; do not substitute Cursor acceptance. When testing workspace operations, preserve returned project/workspace selectors and distinguish the remote executor from the client checkout.
