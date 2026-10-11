---
name: exeora-workspace
description: Open and navigate Exeora's Workspace panel to inspect files, diffs or search results beside a conversation. Use when the user wants to see a project or review changes visually.
---

# Show an Exeora workspace

Use this skill when the user asks to see files, diffs or search results in Exeora. Follow the user's requested project and workspace, resolving their selectors with `list_projects` and `list_workspaces` when needed.

1. Inspect the advertised schemas for `exeora_open_panel`, `exeora_workspace_get_state` and `exeora_workspace_navigate`. Use only navigation targets and fields they actually support.
2. Open the panel once with `exeora_open_panel` and the intended project/workspace and view. Keep the returned `panelId`; use `exeora_workspace_get_state` to inspect that instance and `exeora_workspace_navigate` to move it. Do not open a fresh panel for every navigation or invent an instance ID. If the instance is closed or stale, explain that it must be reopened.
3. Do not say a view opened merely because a request was sent: inspect the returned outcome/state. Navigation only changes the view. Viewing a diff does not authorize staging, committing, pushing or editing.
4. If these tools or embedded UI are unavailable in the host, provide the [Exeora dashboard](https://exeora.dev/dashboard/) and use available read tools for the requested inspection. Explain the host limitation without claiming an embedded panel rendered. If the user requests the full Dashboard and `exeora_open_dashboard` is offered, use it; its separate sign-in does not expand the agent's MCP grant.

File selections and draft comments are not automatically shared with the model. The user explicitly chooses **Add to context** in supported hosts. Do not claim to see comments that were not attached or returned by a tool. Follow user instructions and project policy; a refusal is not a reason to use a different route.
