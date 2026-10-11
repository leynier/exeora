---
name: exeora-setup
description: Connect an Exeora account, discover authorized projects and workspaces, and diagnose missing access or an offline machine. Use for Exeora plugin onboarding and connection setup.
---

# Set up Exeora

Use the Exeora MCP tools exposed by this plugin. The bundled connection is `https://exeora.dev/mcp`; the user signs in through the host's OAuth flow and chooses which projects to authorize. Never request a password, token or client secret in chat.

1. If Exeora tools are unavailable, guide the user to enable the plugin and complete its connection/sign-in flow. Do not claim a connection is working until a tool answers. Hosts without plugin support can add the URL as a Streamable HTTP MCP server with OAuth; this connects tools but does not install these bundled skills.
2. Call `list_projects`. Show project names and location states, and use returned slugs or IDs. If there are no authorized projects, explain how to add a project at [the dashboard](https://exeora.dev/dashboard/) or with `exeora project add /path/to/project` on their machine. An existing project may need to be granted to this client under Clients. Do not add projects or expand grants just for onboarding.
3. Use the user's named project when unambiguous; otherwise ask them to choose. Call `list_workspaces` with that project. Select the requested workspace or clearly identify the default root. Preserve both selectors on subsequent calls; selection is per call, not a persistent server setting.
4. If the selected location is offline, explain that `exeora connect` must stay running on the machine holding it. Do not repeatedly retry or silently switch locations. For Exeora Cloud, report setup or waking state and allow at most two retries of the same read. See [troubleshooting](https://exeora.dev/docs/troubleshooting/) for persistent failures.
5. Finish with the verified project, workspace and location, plus a useful next request. Setup only discovers access; it does not create a workspace, run project commands or edit files.

Use tool names as advertised by the host, which may add a namespace. Follow the user's instructions and the project's enforced policy. Missing tools are not permission to work around policy restrictions.
