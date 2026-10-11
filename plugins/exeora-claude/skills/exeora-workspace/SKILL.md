---
name: exeora-workspace
description: Inspect Exeora workspace files, changes and search results from Claude, with an optional interactive Workspace view when offered by the host. Use when the user asks to see a project or review its changes.
---

# Inspect an Exeora workspace in Claude

Resolve the requested project and workspace through the connector's `list_projects` and `list_workspaces` tools. Keep those selectors on all reads. A request to view changes does not authorize editing, staging, committing or pushing.

1. Discover the tools Claude exposes. Use `list_files`, `read_file`, `grep` and advertised Git read tools to inspect the requested files or changes and summarize the observed result. Do not substitute Claude's sandbox filesystem for the Exeora workspace.
2. If Claude exposes `exeora_open_panel` and supports its MCP App resource, call it with the requested project/workspace and view using its actual schema. The request returning does not prove that Claude rendered an interactive view. Verify an explicit host outcome if one is available; otherwise describe the result without claiming it appeared.
3. Use `exeora_workspace_get_state` or `exeora_workspace_navigate` only if exposed to the model. App-only tools are reserved for the UI, so do not invoke hidden tools or invent panel IDs. Keep a returned `panelId` for any supported navigation rather than opening another panel each time.
4. When interactive UI is unavailable, provide [the Exeora dashboard](https://exeora.dev/dashboard/) and continue with connector read tools. Do not promise ChatGPT Sideapp, file-routing or composer features in Claude. A separate dashboard sign-in does not expand the MCP grant.

Only discuss selections or comments actually returned by tools or explicitly attached by the user. Do not assume an embedded view shares its contents with the model. Respect user instructions, Claude's tool approvals and Exeora's enforced project policy.
