---
name: exeora-project
description: Explore, diagnose, edit and test code in a project connected through Exeora from Claude. Use for coding tasks on the user's Exeora machines or Cloud workspaces.
---

# Work in an Exeora project from Claude

Use the Exeora connector's advertised tools for the requested task. The files and commands operate on the selected machine or Cloud workspace, not Claude's sandbox filesystem. Analysis or review alone does not authorize edits.

1. Read `get_agent_prompt` once per session for current server guidance. Resolve `project` through `list_projects` and `workspace` through `list_workspaces`. Use returned selectors, preserve them on all calls, and never fall back to `main` after a workspace error.
2. Discover the project's instruction files and relevant skills as the server directs. Read them through Exeora's `read_file`, not a Claude sandbox file tool. Inspect existing Git changes and preserve unrelated work.
3. Search with Exeora's `grep`, inspect structure with `list_files`, and read relevant files with `read_file`. Follow truncation offsets. Paths are relative to the selected workspace, not this plugin's installed directory.
4. For authorized changes, use `edit_file`, `write_file` or `apply_patch` with the same routing selectors. Inspect the resulting diff and validate with relevant tests or builds through `run_command`.
5. For long-running work, use `start_command` and retain its handle plus project/workspace. Use `get_command_output`, `send_command_input` and `kill_command` only in that location. Stop processes you started when no longer needed and preserve pre-existing ones.
6. Report changes, observed validation and remaining blockers. Separate remote workspace checks from CI, merge and deployment. Commit, push and deployment stay within the user's requested scope.

Use the names and schemas Claude actually exposes, including any connector namespace. Respect Claude's approval prompts and Exeora's policy; do not suggest **Always allow** to bypass a refusal. Stop on `FORBIDDEN`, `APPROVAL_DECLINED` or `APPROVAL_TIMEOUT`. An offline executor needs reconnecting; a waking executor permits at most two retries of the same call. `UNKNOWN_PROCESS` is a handle or routing failure, not permission to search other workspaces.
