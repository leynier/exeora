---
name: exeora-setup
description: Set up Exeora in Claude web, choose an authorized project and workspace, or diagnose missing tools, access or an offline machine. Use when the user wants to connect or start working through Exeora.
---

# Set up Exeora in Claude

The plugin bundles the remote HTTP connector `https://exeora.dev/mcp`. Installing the plugin loads its skills but does not add the connector or sign the user in. Never request passwords, access tokens or client secrets in chat.

1. If Exeora tools are missing, direct the user to **Customize > Plugins > Exeora > Connectors**. Add the bundled connector if it is not added, then select **Connect** and complete Exeora's OAuth sign-in. On Team or Enterprise, an Owner may need to add it first. Enable Exeora for this conversation under **+ > Connectors**. Do not change persistent permissions or grants on the user's behalf.
2. Call the advertised `list_projects` tool; Claude may prefix its name. A responding tool verifies access, while a downloaded package or an installed CLI plugin does not. If no projects are returned, explain how to add one at [the dashboard](https://exeora.dev/dashboard/) or with `exeora project add /path/to/project` on its machine. An existing project may be outside this client's grant; report that without expanding access.
3. Resolve the user's project with the returned slug or ID, asking only if ambiguous. Call `list_workspaces` for that project. Identify the requested workspace or the default root. Keep both selectors on every subsequent call; they are not a persistent server selection.
4. For `LOCAL_EXECUTOR_OFFLINE`, explain that `exeora connect` must stay running on the machine holding the project. Claude web reaches Exeora's public server, not the user's localhost. Do not silently switch machines. For `EXECUTOR_WAKING`, retry the same read at most twice and then report the state.
5. Report the verified project, workspace and location. Setup discovers access; it does not edit files, create workspaces or run project commands.

Follow the user's instructions and the server's current schemas and enforced policy. `FORBIDDEN`, `APPROVAL_DECLINED` and `APPROVAL_TIMEOUT` are refusals; stop the blocked action rather than finding another route. For persistent connection problems, link [troubleshooting](https://exeora.dev/docs/troubleshooting/).
