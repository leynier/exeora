---
name: exeora-workspace
description: Inspect Exeora workspace files, changes and search results through remote read tools. Use when the user wants to view a project or review its changes.
---

# Inspect an Exeora workspace

Resolve the requested project/workspace using the exposed `list_projects` and `list_workspaces` tools. Keep returned selectors on all reads. Viewing changes does not authorize editing, staging, committing or pushing.

1. Discover the tools the host actually exposes. Use `list_files`, `read_file`, `grep` and advertised Git read tools to inspect the request. Do not substitute a local filesystem or sandbox for the selected Exeora workspace.
2. Summarize the observed files, changes or results with useful paths. Read follow-up offsets when results are truncated. Only discuss selections or attachments actually provided by the user or tools.
3. If the user wants a visual workspace, provide https://exeora.dev/dashboard/ as a separate interface. The package makes no portable promise of embedded MCP Apps, panels, composer routing or interactive host UI. A separate dashboard sign-in does not expand the MCP grant.
4. Keep navigation and inspection read-only until the user authorizes a change. Respect host approvals and the project's enforced policy. Do not call hidden/app-only tools or invent panel IDs.

In GitHub Copilot, distinguish native local repository tools from Exeora remote tools. A local Copilot project or cloud-agent checkout can differ from the selected Exeora workspace. Preserve the remote routing selectors; use only the actual names and schemas exposed by this Copilot surface.
