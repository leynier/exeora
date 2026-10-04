# OpenAI plugin extensions

Exeora exposes an MCP App at `ui://exeora/workspace` on both `/mcp` and `/p/:projectId/mcp`. Its React entry is `/dashboard/mcp-panel`, built alongside the dashboard and Chrome panel. All three reuse the same `Workspace` component.

## Behavior

1. ChatGPT can open **Workspace** from the conversation panel entrypoint. The model can invoke `exeora_open_panel` with optional `project`, `workspace` and relative `path` arguments. The resource requests the `fullscreen` display mode, which ChatGPT uses for entrypoints; the host ultimately decides the available placement.
2. `exeora_open_file` registers supported file extensions. It receives the host's `FileInput`, including an opaque `resourceUri`. When the host provides a filesystem path, Exeora resolves it against the connection's authorized project locations and workspaces. Otherwise the MCP App calls the app-only `exeora_resolve_file`, which receives `_meta["openai/resource"].path` from ChatGPT. A URI or basename alone is never treated as a filesystem path.
3. `exeora_settings_read` and `exeora_settings_update` provide native structured settings. The settings are a default project, default workspace, initial Files/Source Control/Search view, whether to show ignored files, and unified/split diffs. Every property has an effective default. Updates take `{ set: { ...changedProperties } }`, validate routing choices, and merge atomically in D1. Changing the default project clears its previous default workspace unless the update explicitly supplies a replacement.

Preferences are isolated by user, OAuth client, and endpoint. They persist in `plugin_settings` and are deleted with the account. Opening a particular workspace through a tool affects that panel instance; it does not change the connection's saved defaults or other conversations.

## Authorization and transport

The iframe receives no bearer or refresh token. Its API transport calls the app-only `exeora_panel_request` through MCP Apps, returning `{ status, body }` to the existing dashboard API client. Every request rechecks the current connection and project grant. The account endpoint returns only granted projects, machine entries, and terminal sessions. A project endpoint remains bound to its one project.

The proxy exposes only the Workspace routes for the picker, capabilities, reads, file/Git actions and live tickets. Account administration, credentials, provider configuration, AI generation, pull-request writes and workspace removal use the full dashboard. A project policy still restricts changes: readers respect the tool allowlist, file saves respect `write_file`, other mutations require unrestricted access, and actions requiring confirmation return a linkable dashboard instruction. Interactive terminals require an unrestricted policy. Both sockets use one-use tickets bound to a validated ChatGPT sandbox origin; socket ingress accepts that origin only with its corresponding ticket. Request cancellation reaches the relay.

Public JavaScript, CSS and fonts permit cross-origin fetching; the dashboard API gains no CORS access. The UI resource declares only the gateway's resource, connection and base-URI origins, and rewrites build asset references to absolute URLs. The Chrome panel keeps its extension-only framing policy and authentication bridge.

## File routing limits

The OpenAI specification currently lists file entrypoints and filesystem access for **Desktop only**. Thread entrypoints and structured settings also support Work web and mobile. A file must belong to a project/workspace already exposed to this connection. A desktop file path does not identify a remote machine; equal paths on multiple machines require an explicit project/workspace selector. The most deeply nested matching checkout wins, and traversal, outside paths and ungranted projects are refused. The executor remains responsible for canonical filesystem and symlink confinement when the editor reads or writes the relative file.

Files without a registered suffix can still be opened from the Workspace explorer. Detached ChatGPT uploads do not automatically become Exeora workspace files.

## Activation and validation

1. Apply `0028_plugin_settings.sql` before deploying the gateway. No native CLI protocol change or Chrome extension release is needed.
2. Build the site and deploy the gateway with the MCP panel assets. Refresh the MCP connection's tools and metadata in ChatGPT.
3. In a real ChatGPT session, check manual thread opening, a model call to `exeora_open_panel`, each native setting, and a desktop file click on a registered project. Verify a second account, a revoked project, a disconnected machine, and an outside file.

Automated coverage checks legacy initialization, modern discovery, tool/resource metadata, host file resolution, traversal and grant isolation, native settings persistence and concurrent partial edits, the API boundary, restrictive policies, static asset CORS, and the shared panel transport. Browser tests use a simulated MCP Apps host; they do not prove availability or account eligibility in live ChatGPT.

Validation performed in this workspace: full Vitest suite, Playwright browser suite, Biome, file-length check, TypeScript checks, web and Chrome extension builds, a Worker deployment dry run, and frozen dependency installation with CI's Bun 1.3.14. Argent checked automatic fullscreen, file opening, a later file in the same panel, and dashboard links against a simulated host. The gateway socket tests verify sandbox-origin binding and one-use tickets; live ChatGPT terminal/log connections still require activation testing.

Results: 1,616 tests in the full Vitest run, 156 browser scenarios, and 44 consecutive passes of the 11 MCP panel scenarios. Final targeted runs passed all 16 gateway extension tests and 56 panel unit tests after the last routing and stale-default repairs. Temporary browser/server resources were removed; the one Claude Opus Dev terminal is retained for reuse.

Implementation tracking:

- [x] MCP thread entrypoint and model-callable open tool.
- [x] Desktop file entrypoint and authorized workspace path resolution.
- [x] Structured settings, D1 schema and migration.
- [x] Shared Workspace UI entry and MCP Apps bridge.
- [x] Final browser and repository validation.
- [x] Production D1 migration `0028_plugin_settings.sql`, applied on 2026-10-04 at 07:52:22 UTC. Verified the table, composite primary key, defaults, cascading user foreign key and no pending migrations.
- [ ] Gateway deployment and live ChatGPT proof (requires release authorization).

Sources: [OpenAI extensions guide](https://developers.openai.com/plugins/build/extensions), [MCP Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md), [MCP Apps](https://github.com/modelcontextprotocol/ext-apps).
