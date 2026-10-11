# GitHub Copilot

![Exeora](assets/logo.png)

This independent Exeora distribution uses the documented Agent Plugins 1.0 format for GitHub Copilot: root `plugin.json`, root `mcp.json` and three Copilot-adapted skills. It is separate from the pure Agent Plugin and the ChatGPT, Claude web and GrokBot Cursor packages. No provider credentials, grants or persistent approvals are bundled.

## Copilot CLI

Download `exeora-copilot-plugin.zip` from https://exeora.dev/docs/copilot-plugin/ and verify its SHA-256 checksum. Extract it into a dedicated directory with `plugin.json` directly at the root, then use the documented local install:

```sh
copilot plugin install ./exeora-copilot
```

After the repository change is merged, repository installation is also supported:

```sh
copilot plugin install leynier/exeora:plugins/exeora-copilot
```

Inspect the installed components and `/mcp`; if authorization is required, use `/mcp auth <advertised-server-name>` and the client's browser flow. Ask Exeora to list your authorized projects. The installer taking a directory does not imply direct ZIP upload support, and a successful install is not proof of remote authorization.

## GitHub Copilot app

Open **Customize > Plugins**. Use the marketplace control to add the GitHub repository/Git URL `https://github.com/leynier/exeora`, then find `exeora-copilot` and select **Install**. The repository's `.github/plugin/marketplace.json` advertises this package. Follow the host's MCP connection prompts and verify a real Exeora read. The app's guide describes repository marketplaces, not arbitrary ZIP upload. Existing organization policies may restrict installation; do not alter them to bypass a restriction.

## VS Code

The official VS Code guide documents Agent Plugins support. Open Extensions and search `@agentPlugins`, or use **Chat: Open Customizations > Plugins**. Add this repository through the documented `chat.plugins.marketplaces` user setting if permitted, then select **Install**. VS Code also documents automatic discovery of plugins installed with Copilot CLI from `~/.copilot/installed-plugins/`. Check plugin support and existing organization policy; this work does not change either. Components appearing in VS Code still do not establish OAuth there, and current plugin management interfaces can use separate inventories.

## Image and namespace limits

The Exeora PNG above is an ordinary README asset, also used on the website download card. The reviewed GitHub plugin reference, creating guide and VS Code plugin documentation do not define a supported plugin logo/icon/interface manifest field. `com.github.copilot` is documented for client-specific agents, commands, rules, hooks, LSP and automation configuration; its existence is not evidence for image metadata. This package adds no guessed `logo`, `icon`, `interface` or namespace image fields. Host catalog icon rendering is unverified.

## Authentication and verification

The remote server is declared as `streamable-http` at `https://exeora.dev/mcp`, with no headers, static OAuth fields or variables. The standard leaves authentication to the client. Public provider metadata advertises dynamic registration and PKCE, but real OAuth has not been tested in any Copilot surface. GitHub login, plugin installation and an Exeora authorization grant are separate facts. No actual plugin installation, publication or account authorization is claimed.

Schema/build/download tests are local package evidence. Verify each intended surface separately by loading the package, confirming skills and MCP discovery, completing Exeora OAuth, and receiving a successful `list_projects` response. This is GitHub Copilot, not Microsoft 365 Copilot.

Sources: https://docs.github.com/en/copilot/concepts/agents/about-plugins ; https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference ; https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app ; https://code.visualstudio.com/docs/agent-customization/agent-plugins
