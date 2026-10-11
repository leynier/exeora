# Exeora plugin

Connect your AI to projects on your own machines or Exeora Cloud. This package includes the Exeora account MCP connection, three workflow skills, a guided setup skill, listing metadata and icons. Each user signs in with their own Exeora account through OAuth and chooses which projects the client can access.

## Install from the ZIP

1. Download `exeora-plugin.zip` from <https://exeora.dev/docs/plugin/> and extract it into a folder you will keep, for example `exeora-plugin`.
2. Register that extracted folder with `codex plugin marketplace add ./exeora-plugin`. The folder contains its own `.agents/plugins/marketplace.json` catalog. Paths are relative to the folder you extracted, so use the actual path if it is elsewhere.
3. Restart the ChatGPT desktop app, open the Plugins Directory, select the **Exeora** source and install **Exeora**. Complete the Exeora sign-in and consent flow. Local marketplace support depends on the host and workspace policy.
4. Run the plugin's setup workflow, or ask: “Help me connect Exeora and choose a project.” It checks access and lets you choose a workspace.

Keep `exeora connect` running on a machine serving local projects. Projects on Exeora Cloud use their Cloud location. Installation does not automatically register a machine or grant access to existing projects.

## ChatGPT web

At <https://chatgpt.com/plugins>, use **Add custom MCP server**, enter `https://exeora.dev/mcp`, choose OAuth and complete **Create as a plugin**. This connects the server's tools and supported UI; it does not install the skills in this ZIP. Account and workspace policies may limit this option. Installing a ZIP as an ordinary chat attachment does not install this plugin.

The same ZIP can be uploaded by the publisher to the OpenAI developer plugin dashboard for submission. Public directory publication needs verification, MCP connection setup, review materials and approval; downloading this package does not imply a public directory listing exists.

## Included skills

- `exeora-setup`: verify your connection and choose an authorized project and workspace.
- `exeora-project`: explore, diagnose, edit and validate work on the selected machine.
- `exeora-workspace`: show files, diffs and search results in hosts that support the embedded Workspace.

The server enforces each project's policy. This package contains no credentials. For support, see <https://exeora.dev/docs/troubleshooting/> or email hello@exeora.dev. Privacy: <https://exeora.dev/privacy/>. Terms: <https://exeora.dev/terms/>.

Source and skills: AGPL-3.0-only; see `LICENSE`. Exeora's name and mark identify Exeora and do not grant permission to imply endorsement.
