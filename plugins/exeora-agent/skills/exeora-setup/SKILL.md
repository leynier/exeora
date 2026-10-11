---
name: exeora-setup
description: Connect Exeora and discover authorized remote projects and workspaces. Use for Exeora onboarding, missing access or offline machines.
---

# Set up Exeora

Use only the Exeora MCP tools actually exposed by the host. The fixed remote endpoint is `https://exeora.dev/mcp`. Authentication is managed by the host; package installation alone does not establish access. Never request passwords, tokens or client secrets in chat.

1. If tools are missing, use the host's documented plugin/MCP connection workflow. The standard does not prescribe an installation UI, ZIP importer, marketplace or portable OAuth configuration. Confirm that the client supports Agent Plugins 1.0.0 and Streamable HTTP; do not invent native configuration fields.
2. Call `list_projects`, using the advertised names and schemas, including any namespace. Show returned names and states. Use the returned project slug or ID, then call `list_workspaces` and select the requested workspace. If selection is ambiguous, ask the user; never silently fall back to main after an error.
3. If there are no projects, explain adding a project at https://exeora.dev/dashboard/ or with `exeora project add /path/to/project` on the user's machine. Existing access may be restricted to authorized projects. Do not create projects, expand grants or change persistent approvals just for setup.
4. Keep the project/workspace selectors on every subsequent call; selection is not a persistent server setting. For offline machines explain that `exeora connect` must remain running on the machine holding the project. A waking Cloud executor permits at most two retries of the same read; never silently change location.
5. Report only tool-observed access, selected location and next useful request. Onboarding does not authorize edits, workspace creation, commands, commits or publication.

Respect the user's scope, the host's approval prompts and Exeora's enforced project policy. Missing tools or `FORBIDDEN`, `APPROVAL_DECLINED` and `APPROVAL_TIMEOUT` are not permission to bypass restrictions.
