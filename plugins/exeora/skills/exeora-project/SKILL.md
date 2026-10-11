---
name: exeora-project
description: Explore, diagnose, edit and test code in a project connected through Exeora. Use when the user wants coding work on their Exeora machines or Cloud workspaces.
---

# Work in an Exeora project

Exeora tools operate on real files on the selected machine. Use this workflow for the user's requested coding task; analysis or review alone does not authorize edits.

1. Read `get_agent_prompt` once per session for the current server guidance. Discover the project with `list_projects` and its workspace with `list_workspaces`; use returned selectors and resolve ambiguity before acting. Keep the same `project` and `workspace` on file, command and process calls. Never fall back to `main` after a workspace error.
2. Follow the server's instruction-file discovery and `list_skills` guidance. Read the relevant instructions with Exeora's `read_file`, so you inspect the selected remote checkout rather than the host's local filesystem. Check existing Git changes before editing and preserve unrelated work.
3. Search with `grep`, inspect directory structure with `list_files`, then read the relevant files. Follow truncation offsets. Paths are relative to the selected workspace; do not substitute an absolute path from the machine or this plugin's installation directory.
4. For authorized changes, use `edit_file` for existing files, `write_file` for new files, and `apply_patch` for a coordinated set of changes. Inspect returned diffs. Verify with the project's relevant tests or build through `run_command`.
5. Use `start_command` for a server or long-running operation. Save its handle and routing selectors, then use `get_command_output`, `send_command_input` and `kill_command` in that same workspace. Stop processes you started when no longer needed and preserve pre-existing ones.
6. Report what changed, observed verification and remaining blockers. Distinguish a local check from CI, merge or deployment. Commit, push, publish and deployment must remain within the user's requested scope.

Call only advertised tools, using their current schemas. `FORBIDDEN`, `APPROVAL_DECLINED` and `APPROVAL_TIMEOUT` are decisions: report the refusal and stop the blocked action. `LOCAL_EXECUTOR_OFFLINE` needs the user's machine reconnected; do not retry in a different location. On `EXECUTOR_WAKING`, retry the same call at most twice. For `UNKNOWN_PROCESS`, report the handle/routing failure without searching other workspaces. Direct user instructions take precedence over workflow advice; the server still enforces authorization and project policy.
