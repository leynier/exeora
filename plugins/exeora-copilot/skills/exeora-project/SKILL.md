---
name: exeora-project
description: Explore, diagnose, edit and test code through Exeora remote project tools. Use for authorized coding work on Exeora machines or Cloud workspaces.
---

# Work in an Exeora project

Use the Exeora server's advertised tools for the requested task. Exeora paths refer to the selected remote workspace, not the host agent's local checkout, sandbox or plugin installation directory. Analysis and review requests alone do not authorize edits.

1. Read `get_agent_prompt` once per session. Resolve project and workspace with `list_projects` and `list_workspaces`, using returned IDs/slugs. Preserve both selectors on every call. Never fall back to main after a routing failure.
2. Discover and read the project's instruction files and relevant skills through the remote tools. Inspect Git changes and preserve unrelated user and agent work.
3. Search with `grep`, inspect structure with `list_files` and read with `read_file`, following any truncation offsets. Use only schemas actually exposed by the host.
4. For authorized implementation, use `edit_file`, `write_file` or `apply_patch` with the same selectors. Review the resulting diff and run relevant tests/builds through remote `run_command`.
5. Retain each `start_command` handle together with its project/workspace. Use `get_command_output`, `send_command_input` and `kill_command` only there. Stop processes you created when no longer needed, and preserve pre-existing ones. `UNKNOWN_PROCESS` is a routing/handle failure, not permission to search other workspaces.
6. Report observed changes and validation with remaining blockers. Distinguish remote tests, CI, merge, deployment and real host authentication. Commit, push, merge or deploy only within the authorized scope.

Respect approval prompts and server policy. Stop on `FORBIDDEN`, `APPROVAL_DECLINED` or `APPROVAL_TIMEOUT`; do not change persistent permissions or propose a bypass. An offline executor needs reconnecting; a waking executor permits at most two retries of the same call. Never put authentication secrets into files, commands or chat.

In GitHub Copilot, distinguish native local repository tools from Exeora remote tools. A local Copilot project or cloud-agent checkout can differ from the selected Exeora workspace. Preserve the remote routing selectors; use only the actual names and schemas exposed by this Copilot surface.
