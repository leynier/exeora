# ChatGPT import and public web distribution

Verified against official OpenAI documentation on 2026-10-11 UTC. The objective is public users installing Exeora without manually registering its MCP URL. The five separate packages remain intact; the experimental MCP fixture is retained.

## Actual archive evidence

| Archive examined locally | Bytes | SHA-256 | Declared MCP |
| --- | --- | --- | --- |
| Sent experimental v1 | 23,647 | `bdaf3e4aee45cfd3cbf570fae17688146aca14451aa60ba4ed74fc2814befb31` | Root `mcp.json` plus Claude `.mcp.json` and Cursor `cursor.mcp.json`; all remote `https://exeora.dev/mcp` |
| Separate OpenAI v1.0.0 | 24,392 | `7f289d690baacd71b1dd8c17a6d0e7602877e248517f78601e1815406aa9cb97` | Root `mcp.json`, `streamable-http`, same HTTPS endpoint |

[Desktop-only plugins](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins) explicitly includes imported remote HTTPS MCP, dot/non-dot filenames and inline declarations. Thus both examined archives meet that classification condition. No local executable or competing manifest is needed to explain it. The user's report does not identify which of three ZIPs was tested; it is preliminary Claude web import/use success, not complete OAuth proof. No replacement was sent because a documentation correction cannot enable web MCP imports.

## Existing apps are a different route

The same [management reference](https://learn.chatgpt.com/docs/enterprise/plugin-management#reference-an-existing-app-with-appjson) accepts `.app.json` references to existing IDs beginning `asdk_app_`, `connector_` or `templated_apps_`, excluding plugin IDs. The [packaging guide](https://developers.openai.com/plugins/build/plugins#add-openai-specific-metadata) places this mapping at `extensions.com.openai.apps`. References create neither apps nor access: existing availability, role controls and member authentication remain necessary.

A bounded search of maintained product sources (`plugins`, `docs`, `scripts`, `apps`) found no registered Exeora app IDs. Private manually registered owner connections would not satisfy public distribution even if found. No IDs were invented, no `.app.json` added and no registration/grants changed.

## Official public path

The [submission guide](https://developers.openai.com/plugins/deploy/submission) separates draft upload, automated checks, review and publication:

1. An authorized publisher selects the owning organization/project and verified publishing identity, then uploads a ZIP including remote MCP and skills.
2. In MCPs, connect the server, complete the portal's domain challenge and authentication, and resolve metadata/skill/tool scans. Only one server can be connected per plugin.
3. Supply a dedicated reviewer account outside the ZIP, five positive and three negative cases, a walkthrough and release notes. Actual runs and required checks precede review.
4. Submit for review; approval permits a separate Publish action. App-reference and lifecycle-hook ZIPs are currently excluded from submission. DCR/CIMD discovery avoids shipping client credentials; authorization still occurs in the portal.

[Review requirements](https://developers.openai.com/plugins/deploy/app-review) document finding a published plugin by exact name or directory link. This removes user URL registration, not their account authentication and consent. Private/workspace use relies on custom connections; [workspace publishing](https://developers.openai.com/plugins/build/plugins#publish-a-local-plugin-to-your-workspace) stays within that organization. No official public-by-link bypass of review was found; a directory link refers to an already published listing.

## Preparation and external blockers

`bun run plugin:check:submission` checks the unchanged OpenAI archive against official portable schemas, remote HTTPS, absent app references/hooks, listing URLs and bundled images. This is deliberately a local subset, not OpenAI portal validation or a claim of eligibility. The build remains `bun run plugin:build`; both commands avoid account or network mutations.

Publisher access and identity, a real domain challenge, MCP connection/scans, reviewer account/test runs/video, approval and publication have not been verified or performed. Public metadata advertises OAuth discovery, DCR, CIMD and PKCE; real exchanges remain untested. No review account, credentials, permission grant or challenge token is created by this PR. Shipping this code and merging its PR does not publish a plugin or establish ChatGPT web availability.
