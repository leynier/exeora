# Exeora for Claude web

Connect Claude to projects on your own machines or Exeora Cloud. This independent Claude package contains three guided skills, a remote MCP connector and Exeora's listing icon. It does not replace the ChatGPT/Codex package or include passwords, tokens, client secrets, executable hooks or local MCP processes.

## Install in Claude web

1. Download `exeora-claude.plugin` or `exeora-claude-plugin.zip` from [the Exeora site](https://exeora.dev/docs/claude-plugin/). Both files contain the same ZIP archive; upload either without extracting it.
2. In Claude web, open **Customize > Plugins > Add > Upload plugin** and select the downloaded file. Plugins require Pro, Max, Team or Enterprise and may be restricted by organization policy. Attaching the file to an ordinary chat does not install it.
3. Open **Exeora > Connectors**. Add the Exeora connector if it is not added, then choose **Connect** and complete Exeora's OAuth sign-in. Team/Enterprise organizations need an Owner to add the connector before members connect with their own account. Installation alone neither adds a connector nor signs you in.
4. Enable Exeora for this conversation under **+ > Connectors**. Choose the setup skill from the `/` menu or ask “Help me connect Exeora and choose a project.” A successful `list_projects` call verifies access.

An alternative is **Add > Add marketplace** with `https://github.com/leynier/exeora`; the repository's `.claude-plugin/marketplace.json` lists this package. Organization policy can restrict repository sources. No claim of an approved public directory listing is made.

## Connection and permissions

`.mcp.json` declares the fixed HTTP endpoint `https://exeora.dev/mcp`. Claude web uses the plugin's Connectors tab to discover OAuth and authenticate. It supports detected authentication, Claude's published client identity, automatic registration, or a separately configured OAuth client in the connector UI. This package needs no fixed client ID or secret. If manual connector configuration is necessary, retain OAuth sign-in; automatic registration is available for Exeora. Do not select “No sign in” or add a shared bearer token for this endpoint.

OAuth client IDs, callback ports, discovery overrides and scope pins documented for Claude Code are not established as Claude web plugin manifest controls, so they are omitted. User consent and Exeora's project policy decide access. Never change grants or persistent tool approvals merely to complete setup. Select the projects you actually intend to authorize; installing this package does not create or expand a grant.

For local projects, keep `exeora connect` running and add them on their machine using `exeora project add /path/to/project`. Claude's remote connector reaches the public Exeora gateway from Anthropic's infrastructure, not your localhost or private network. Exeora's outbound executor connection handles the machine side.

## Included workflows and limits

- `exeora-setup`: connect the account and discover authorized projects and workspaces.
- `exeora-project`: inspect, edit and validate code with the remote connector's tools.
- `exeora-workspace`: inspect files and changes, with an optional MCP App view when Claude exposes it. Read tools and the Exeora dashboard provide a fallback.

Skills and fixed-URL remote connectors are supported in web chat. Hooks and sub-agents are not needed here; web chat ignores them. Local MCP servers do not run in chat, and a top-level `bin/` prevents web installation. The icon and policy/support URLs use documented directory-listing fields; their presence does not guarantee a custom upload's visual presentation. ChatGPT Sideapp/composer/file-routing behavior is not promised in Claude.

The download is structurally checked and tested in this repository. Claude Code validation checks parsing only: a CLI install does not add a plugin to your Claude web account or prove web upload, MCP App rendering or real OAuth. Account installation and real authentication remain separate manual acceptance checks.

## Official references

- [Use plugins in Claude](https://support.claude.com/en/articles/13837440-use-plugins-in-claude)
- [Plugin structure and web testing](https://claude.com/docs/plugins/build)
- [Component support by platform](https://claude.com/docs/plugins/platform-support)
- [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)
- [Custom remote connectors and authentication](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Plugins API and upload constraints](https://platform.claude.com/docs/en/manage-claude/plugins-api)

The Plugins API manages organization plugins with scoped organization credentials; it is not the Messages API or a requirement for a personal web upload. This project does not call that API or publish to Anthropic's directory as part of generating the download.
