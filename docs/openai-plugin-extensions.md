# OpenAI plugin extensions

Exeora exposes an MCP App at `ui://exeora/workspace` on both `/mcp` and `/p/:projectId/mcp`. Its React entry is `/dashboard/mcp-panel`, built alongside the dashboard and Chrome panel. All three reuse the same `Workspace` component. A separate global Sideapp at `ui://exeora/dashboard`, built as `/dashboard/mcp-dashboard`, reuses the full dashboard shell and routes.

## Behavior

1. ChatGPT can open **Exeora Workspace** from the conversation panel entrypoint. The model can invoke `exeora_open_panel` with optional `project`, `workspace`, `tab`, relative `path`, `diff` or `search` arguments. The resource requests the `fullscreen` display mode, which ChatGPT uses for entrypoints; the host ultimately decides the available placement.
2. `exeora_open_file` registers supported file extensions. It receives the host's `FileInput`, including an opaque `resourceUri`. When the host provides a filesystem path, Exeora resolves it against the connection's authorized project locations and workspaces. Otherwise the MCP App calls the app-only `exeora_resolve_file`, which receives `_meta["openai/resource"].path` from ChatGPT. A URI or basename alone is never treated as a filesystem path.
3. `exeora_settings_read` and `exeora_settings_update` provide native structured settings. The settings are a default project, default workspace, initial Files/Source Control/Search view, whether to show ignored files, and unified/split diffs. Every property has an effective default. Updates take `{ set: { ...changedProperties } }`, validate routing choices, and merge atomically in D1. Changing the default project clears its previous default workspace unless the update explicitly supplies a replacement.

4. **Exeora Dashboard** is a global entrypoint, opened from the host sidebar or by `exeora_open_dashboard({})`. It includes all existing dashboard routes and uses its own user sign-in.

Preferences are isolated by user, OAuth client, and endpoint. They persist in `plugin_settings` and are deleted with the account. Opening a particular workspace through a tool affects that panel instance; it does not change the connection's saved defaults or other conversations.

## Workspace navigation

`exeora_open_panel` preserves its original tool name and resource URI. `tab` accepts `explorer`, `search`, `source`, `pr`, `terminal` and `logs`. `path` opens an Explorer file. `diff: { path, area: "working" | "staged" }` opens Source Control, defaulting to `working`. `search: { query, regex?, caseSensitive?, wholeWord?, include?, exclude?, includeIgnored? }` applies the Search query and filters; omitted filters are false or empty strings. An empty query clears Search. Search strings are bounded to 1,000 characters. A content target infers its tab, and conflicting targets or an incompatible explicit tab are rejected.

The Workspace instance exposes native MCP App tools `exeora_workspace_get_state({})` and `exeora_workspace_navigate({ ...selection })`. These address the open instance in the current conversation. Omitted routing fields preserve the current project/workspace. UI state and model context contain navigation metadata, not file contents or credentials. Navigation returns `applied` with the actual UI state once shown, `queued` if rendering has not settled within five seconds, `needs_confirmation` while user confirmation is pending, `error` on refusal, or `superseded` when a newer navigation wins. The state reports whether the last confirmation was applied or cancelled. Later host tool results and deep links use the same navigation controller. Changing tabs or opening another file keeps unsaved buffers; leaving a project/workspace with dirty buffers requires user confirmation. State is isolated by instance, project and workspace.

## Authorization and transport

The Workspace iframe receives no bearer or refresh token. Its API transport calls the app-only `exeora_panel_request` through MCP Apps, returning `{ status, body }` to the existing dashboard API client. Every request rechecks the current connection and project grant. The account endpoint returns only granted projects, machine entries, and terminal sessions. A project endpoint remains bound to its one project.

The proxy exposes only the Workspace routes for the picker, capabilities, reads, file/Git actions and live tickets. Account administration, credentials, provider configuration, AI generation, pull-request writes and workspace removal use the full dashboard. A project policy still restricts changes: readers respect the tool allowlist, file saves respect `write_file`, other mutations require unrestricted access, and actions requiring confirmation return a linkable dashboard instruction. Interactive terminals require an unrestricted policy. Both sockets use one-use tickets bound to a validated ChatGPT sandbox origin; socket ingress accepts that origin only with its corresponding ticket. Request cancellation reaches the relay.

Public JavaScript, CSS and fonts permit cross-origin fetching. The Dashboard Sideapp uses narrowly configured CORS for validated HTTPS ChatGPT sandbox origins and bearer requests; it does not share gateway cookies. Actual API requests still require the normal OAuth scopes and owner or admin checks. The UI resource declares only the gateway's resource, connection and base-URI origins, and rewrites build asset references to absolute URLs. The Chrome panel keeps its extension-only framing policy and authentication bridge.

## Dashboard Sideapp sign-in

The Sideapp discovers its reserved public client through `/oauth/sideapp-client`. It generates S256 PKCE locally, starts `/oauth/device/code`, shows the verification code and opens the first-party browser verification page through the host. The existing device flow expires after 600 seconds and polls initially every five seconds. After browser sign-in and consent, it redeems the one-use authorization code at `/oauth/token` with its verifier. Device grants reuse the existing D1 table; no new migration is required.

Only the reserved Sideapp UI client may use this flow with `dashboard:manage`. Third-party MCP clients retain their MCP-only scope ceiling. The Dashboard session belongs to the signed-in user and is stored only in the Sideapp session, with an in-memory fallback for blocked browser storage. The Workspace tools and transport do not receive this token or its broader permissions. Logout and token expiry end the Sideapp session. Live terminal/log tickets issued with a validated Sideapp bearer are bound to that sandbox origin.

## File routing limits

The OpenAI specification currently lists file entrypoints and filesystem access for **Desktop only**. Thread entrypoints and structured settings also support Work web and mobile. A file must belong to a project/workspace already exposed to this connection. A desktop file path does not identify a remote machine; equal paths on multiple machines require an explicit project/workspace selector. The most deeply nested matching checkout wins, and traversal, outside paths and ungranted projects are refused. The executor remains responsible for canonical filesystem and symlink confinement when the editor reads or writes the relative file.

Files without a registered suffix can still be opened from the Workspace explorer. Detached ChatGPT uploads do not automatically become Exeora workspace files.

## Activation and validation

1. Apply `0028_plugin_settings.sql` before deploying the gateway. No native CLI protocol change or Chrome extension release is needed.
2. Build the site and deploy the gateway with both MCP Workspace and Dashboard assets. Refresh the MCP connection's tools and metadata in ChatGPT.
3. In a real ChatGPT session, check manual thread opening, a model call to `exeora_open_panel`, native instance tool discovery and later navigation, the global Dashboard entry and its independent sign-in, each native setting, and a desktop file click on a registered project. Verify a second account, a revoked project, a disconnected machine, and an outside file.

Automated coverage checks legacy initialization, modern discovery, tool/resource metadata, host file resolution, traversal and grant isolation, native settings persistence and concurrent partial edits, the API boundary, restrictive policies, static asset CORS, and the shared panel transport. Browser tests use a simulated MCP Apps host; they do not prove availability or account eligibility in live ChatGPT.

Validation of the initial Workspace implementation: full Vitest suite, Playwright browser suite, Biome, file-length check, TypeScript checks, web and Chrome extension builds, a Worker deployment dry run, and frozen dependency installation with CI's Bun 1.3.14. Argent checked automatic fullscreen, file opening, a later file in the same panel, and dashboard links against a simulated host. The gateway socket tests verify sandbox-origin binding and one-use tickets; live ChatGPT terminal/log connections still require activation testing.

Results: 1,616 tests in the full Vitest run, 156 browser scenarios, and 44 consecutive passes of the 11 MCP panel scenarios. Final targeted runs passed all 16 gateway extension tests and 56 panel unit tests after the last routing and stale-default repairs. Temporary browser/server resources were removed; the one Claude Opus Dev terminal is retained for reuse.

Validation of the Dashboard and navigation follow-up: the final full Vitest run passed 1,720 tests in 171 files with CI's Bun 1.3.14. The full browser suite passed 169 scenarios before the final opening-intent repairs; the final affected MCP suite passed all 26 scenarios, including the two new picker cases. TypeScript, Biome, file-length checks, web and Chrome extension builds, and a Worker deployment dry run passed. Real OAuth-provider tests cover device consent, PKCE exchange, replay, denial and scope isolation. Argent verified navigation, preserved edits, Dashboard sign-in and logout against a simulated host. No gateway deployment or live ChatGPT validation was performed for this follow-up, and no new database migration is required. Temporary browser and server resources were removed; the existing Claude Opus Dev terminal was reused and retained.

Implementation tracking:

- [x] MCP thread entrypoint and model-callable open tool.
- [x] Desktop file entrypoint and authorized workspace path resolution.
- [x] Structured settings, D1 schema and migration.
- [x] Shared Workspace UI entry and MCP Apps bridge.
- [x] Final browser and repository validation.
- [x] Production D1 migration `0028_plugin_settings.sql`, applied on 2026-10-04 at 07:52:22 UTC. Verified the table, composite primary key, defaults, cascading user foreign key and no pending migrations.
- [x] Extended Workspace navigation contract and global Dashboard resource registration.
- [x] Independent Sideapp PKCE device login and scoped sandbox CORS.
- [x] Workspace native navigation, preserved buffers and Dashboard UI integration validation.
- [ ] Gateway deployment and live ChatGPT proof.

Sources: [OpenAI extensions guide](https://developers.openai.com/plugins/build/extensions), [MCP Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md), [MCP Apps](https://github.com/modelcontextprotocol/ext-apps).
