# Official ChatGPT Integration Design

> Historical design: superseded by the user-requested restoration of the account-level Codex integration. The dashboard and gateway no longer use this per-machine flow. Published CLI 0.21.0 commands and protocol compatibility remain available independently. See the current AI Assist and self-hosting documentation.

Status: selected implementation design, 2026-10-02. Architecture and UX prepared through the existing Claude Opus Dev profile in this workspace. Replaces the unofficial Codex-client link in `apps/gateway/src/ai/providers/openai.ts` with OpenAI's documented "ChatGPT plan usage in your open-source app" flow (Sign in with ChatGPT, dynamic agent registration, public Responses API).

## 1. Recommendation

Move the ChatGPT plan link out of the Cloudflare gateway and into the Exeora CLI running on the person's own machine. The CLI owns the documented loopback OAuth flow, the per-host `ext_agent_host_id`, the per-registration credential file, refresh, revocation, the account model catalog and the `POST https://api.openai.com/v1/responses` call. The gateway and dashboard only orchestrate: they ask a connected machine to start a sign-in, read its status, list its models and run a generation over the existing relay `workspace.call` channel. OpenAI tokens never reach the gateway, D1, the browser or the relay.

This is the only path that is documented as available to Exeora today without OpenAI approval, and it matches the repository's real topology: generation already reads the staged patch from the same machine that would hold the tokens.

The OpenAI API-key path, the Grok device login and Grok/OpenAI API keys stay in the gateway exactly as they are. The Codex device flow and every `chatgpt.com/backend-api` call are deleted. Existing Codex-issued `openai`/`oauth` rows are treated as legacy links that must be replaced, never reused.

## 2. Sources

All facts below were read from the official pages on 2026-10-02 (Markdown variants fetched by appending `.md`).

| Topic | Page |
| --- | --- |
| Availability, scopes, flow overview | https://developers.openai.com/siwc/quickstart |
| OSS overview, client vs host, host-ID formats, "paid or remotely hosted" needs the interest form | https://developers.openai.com/siwc/token-sharing-open-source |
| Authorization parameters, callback, exchange, ID-token and scope validation, credential file | https://developers.openai.com/siwc/token-sharing-open-source/sign-in |
| Model catalog and Responses streaming | https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference |
| Request-body restrictions and unsupported features | https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations |
| Multiple accounts, reauthorization, refresh, revocation, credential security, Manage usage link | https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions |
| Remote VM procedure (OAuth locally, transfer credentials) | https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms |
| Token response fields, lifetimes, access-token claims | https://developers.openai.com/siwc/token-sharing-open-source/token-reference |
| Declined plan permission, structured error codes, refresh errors | https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery |
| Hosted website sign-in contract and prerequisites (client ID, registered callback) | https://developers.openai.com/siwc/website |
| Client ID for hosted sign-in: waitlist via interest form | https://developers.openai.com/siwc/request-client-id |
| Button label, welcome modal, settings card, Manage usage, usage-limit state | https://developers.openai.com/siwc/ui-ux-guidelines |

## 3. Baseline before implementation (2026-10-02)

- `apps/gateway/src/ai/providers/openai.ts`: `authKinds: ["oauth", "api_key"]`. OAuth uses the Codex public client `app_EMoamEEZ73f0CkXaXp7hrann`, the undocumented `deviceauth/usercode` and `deviceauth/token` endpoints, `https://auth.openai.com/oauth/token`, then `chatgpt.com/backend-api/codex/responses` and `/codex/models` with `originator: codex_cli_rs` and a `chatgpt-account-id` header. The models-and-inference page says explicitly not to point plan usage at ChatGPT's `backend-api` endpoints.
- `apps/gateway/src/ai/credentials.ts`, `logins.ts`, `db/schema-ai.ts`: one encrypted row per `(user_id, provider)` in `ai_providers`, device logins in `ai_device_logins`, renewal with optimistic concurrency. Kinds are `oauth | api_key`; there is no scope, client ID, subject or host ID.
- `apps/gateway/src/ai/routes.ts`, `routes-generate.ts`: account routes under `/api/ai/*`; generation under `/api/projects/:id/ai/*` dispatches `staged_context`/`range_context` to the project's machine, builds the prompt in the gateway, calls the provider from the Worker.
- `apps/web/dashboard/src/components/ai/AiProvidersCard.tsx`, `AiDeviceLoginDialog.tsx`, `GenerateButton.tsx`, `api-ai.ts`: one row per provider with "Link subscription" (device code) and "Use an API key", plus a disclaimer that the subscription flows are unofficial.
- `crates/exeora-cli`: already has a loopback OAuth listener (`auth/mod.rs`, axum on `127.0.0.1:0`, path `/callback`), `open`, `oauth2`, `reqwest` with rustls, `uuid` v4, `crate::private::write` (owner-only, written beside and renamed over), a config lock pattern (`config.rs`), and feature announcement in `hello.capabilities.features` (`connection.rs::announced_features`) that the relay enforces per action (`relay-do-caller-starts.ts`). `project_prepare` is already answered before project lookup, which is the precedent for device-level actions.
- License is AGPL-3.0. The hosted gateway has a paid `pro` plan (`apps/gateway/src/plans.ts`).

## 4. Options considered

| Option | What it needs | Verdict |
| --- | --- | --- |
| A. Hosted partner OAuth in the gateway (registered `https://` callback, `oaiapp_` client) | A client ID and registered callback from OpenAI. Website sign-in is "available to selected commercial partners through a limited trial"; plan usage in "a paid or remotely hosted app" requires the interest form. | Not available without OpenAI approval. Keep as a future seam only. |
| B. CLI-owned local integration bridged to the dashboard | Nothing from OpenAI for the OSS flow ("needs neither a client secret nor a partner API key"); loopback `127.0.0.1` callback on the machine running the browser; per-host ID. | Recommended. Matches the documented contract and Exeora's machine-side architecture. |
| C. CLI signs in locally, uploads tokens to the gateway for Worker-side inference | Same OAuth as B, then tokens stored in D1 and used from Cloudflare. | Rejected. The Worker becomes a remotely hosted multi-tenant runtime using plan tokens, which is the case the docs route to the interest form; it also moves secrets off the host and breaks the per-host ID model. The self-hosted-VM transfer is for the same tool on the user's own VM, not a SaaS backend. |
| D. Keep the Codex client | Undocumented endpoints. | Rejected by the user and by the models-and-inference page. |

## 5. External prerequisites (separate from implementation)

1. Scope decision confirmed by the owner: use the open-source local CLI flow. The owner answered "Si, porque es OpenSource" to the eligibility question. The implementation enables orchestration for local machines while authentication, credentials, refresh and inference remain on the user's machine. This is not evidence of an OpenAI-issued hosted partner registration; Worker-side plan inference, hosted website identity sign-in and Exeora Cloud machines remain outside this implementation. A future hosted integration would use the interest form and issued registration described in the official docs.
2. Approved branding. The guidelines require "approved OpenAI branding" for the button. Use OpenAI's published asset if one is obtained; until then render a text-only button labeled exactly "Continue with ChatGPT" with no recreated logo.
3. Hosted sign-in (option A) needs an OpenAI-issued client ID, registered callback and token-endpoint auth method (https://developers.openai.com/siwc/website, "Before you begin"). Not required for this design.

## 6. Spec

### Behavior

- A person signs a specific local machine in to ChatGPT from the dashboard ("Continue with ChatGPT") or from that machine's terminal (`exeora chatgpt login`). Each machine is its own agent host with its own `ext_agent_host_id`; the issued `client_id` is reused across that machine's sign-ins for the same account.
- Generations chosen with provider `chatgpt` run on the machine that holds the project or workspace, with that machine's active ChatGPT registration, through the public Responses API.
- No silent billing fallback: a ChatGPT failure never retries with an API key or another provider. Switching is an explicit user choice in the UI.
- OpenAI API keys and Grok (device login and API key) behave exactly as today.
- Existing Codex-issued links are shown as "Old sign-in", never used, and removable.

### Success criteria

- No code path calls `chatgpt.com/backend-api`, the Codex client ID, or the device-auth endpoints.
- Authorization requests carry exactly the documented parameters; callbacks are validated for `state`, `error`, `code`, and issued `client_id`; ID tokens are verified (signature via JWKS, `iss`, `aud` = issued client ID, `exp`, `nonce`, `sub`); plan usage is enabled only when the token response's `scope` contains `chatgpt.tokens.use.direct`.
- Inference requests contain only `model`, `instructions`, `input` (array), `store: false`, `stream: true`; success only on `response.completed`.
- Tokens exist only in owner-only files on the host; never in gateway logs, D1, relay frames, dashboard responses or URLs returned to the browser.
- Structured errors reach the UI with the documented recovery (usage limit, not eligible, plan disabled, reconnect, unavailable) and the request ID.

### Non-goals

- Sign in to Exeora itself with ChatGPT (website identity flow, needs partner client ID).
- Inference from the Worker with plan tokens, credential transfer into the gateway, or ChatGPT on Exeora Cloud machines (Exeora-hosted VMs).
- `exeora chatgpt import` for self-hosted VMs (documented procedure exists; follow-up, see 11).
- Codex app-server integration, WebSocket transport, tools, usage dashboards inside Exeora.

## 7. Design

### 7.1 Topology

```text
Dashboard ──HTTPS──> Gateway Worker ──relay workspace.call──> CLI on the person's machine
   │  Continue with ChatGPT                                   │  loopback 127.0.0.1:<port>/auth/callback
   │  opens authorize URL (no id_token_hint)                  │  ~/.config/exeora/chatgpt/{host.json,accounts/*.json}
   └──────── browser on that same machine ──auth.openai.com──>┘  POST api.openai.com/v1/responses (Bearer)
```

The browser must run on the machine being signed in, because `127.0.0.1` resolves to the browser's computer (stated on the self-hosted-VMs page). The dashboard says so and offers the terminal command for other cases.

### 7.2 Protocol (`packages/protocol`)

New file `src/workspace-chatgpt.ts`, assembled into `WorkspaceAction`, with feature `CHATGPT_V1 = "chatgpt-v1"` in `workspace-features.ts`. The relay already refuses an action whose feature the CLI did not announce; `workspaceTab` gets a `"ChatGPT"` label so the refusal reads "Update the Exeora CLI on this machine to use ChatGPT."

| Action | Input | Value (`kind`) |
| --- | --- | --- |
| `chatgpt_status` | `{}` | `chatgpt_status`: `{ state, account?, pending? }` |
| `chatgpt_login_start` | `{ mode: "new" \| "reauth" \| "enable_plan" }` | `chatgpt_login`: `{ authorizeUrl, expiresAt }` |
| `chatgpt_login_cancel` | `{}` | `chatgpt_status` |
| `chatgpt_logout` | `{}` | `chatgpt_logout`: `{ revocationConfirmed: boolean }` |
| `chatgpt_models` | `{}` | `chatgpt_models`: `{ models: Array<{ id: slug, label: display_name }> }` |
| `chatgpt_generate` | `{ model?: string, instructions: string, input: string }` (bounded: same limits as the prompt builder, model matches `isModelId`) | `chatgpt_generation`: `{ outcome: "completed", text, model }` or `{ outcome: "failed", reason, code?, param?, httpStatus?, requestId? }` |

`state` is one of `signed_out`, `pending`, `ready` (plan usage granted), `plan_disabled` (signed in, scope missing), `reconnect` (tokens unusable, registration kept), `client_invalid`, `unavailable_on_cloud`. An optional `loginError` is a closed enum of safe codes for the latest failed authorization attempt; the UI stops polling and offers recovery without showing provider bodies. `account` is `{ label, email, scopes, planUsage, newRegistration, noticeId? }`; never a token, client secret material or `id_token`.

Failures in `chatgpt_generate` are returned as a value, not an `ExeoraError`, so the code/param/request ID survive without widening the error-code enum. `reason` is one of `usage_limit`, `not_eligible`, `plan_disabled`, `reconnect`, `unsupported`, `route_not_supported`, `permission`, `region_or_policy`, `temporarily_unavailable`, `incomplete`, `interrupted`, `model_unavailable`, `signed_out`, `failed`.

These actions are device-level: the CLI answers them before project lookup, like `project_prepare`. They are excluded from the generic dashboard routes (`apps/gateway/src/api/workspace.ts` `/workspace/reads` and `/workspace/actions` must reject `chatgpt_*`) and from every MCP tool mapping, so only the dedicated AI routes can spend plan usage. Run `exeora-protocol-gen` after the schema change.

### 7.3 CLI (`crates/exeora-cli/src/chatgpt/`)

Modules: `mod.rs` (service, one per process, `Arc` shared with `connection.rs`), `host.rs`, `store.rs`, `oauth.rs`, `id_token.rs`, `inference.rs`, `models.rs`, `errors.rs`, and `commands.rs` for clap.

Constants (all documented): authorize `https://auth.openai.com/api/accounts/authorize`, token `https://auth.openai.com/api/accounts/oauth/token`, discovery `https://auth.openai.com/.well-known/openid-configuration` (read `issuer`, `jwks_uri`, `revocation_endpoint` at runtime; reject any endpoint whose host is not `auth.openai.com`), resource `https://api.openai.com/v1`, models `https://api.openai.com/v1/models`, responses `https://api.openai.com/v1/responses`, initial client `dynamic_agent_client`, `agent_name_hint = "Exeora"`, usage link `https://chatgpt.com/settings/usage`.

Host ID (`host.rs`): `<config_dir>/chatgpt/host.json` with `ext_agent_host_id = "urn:uuid:<uuidv4>"`, created once before the first sign-in and never regenerated. Independent of Exeora's device ID so it does not correlate with Exeora identifiers (docs: opaque, not a user identifier). A JWK-thumbprint ID is optional per docs; UUID is the simpler supported choice.

Store (`store.rs`): one record per issued `client_id` at `<config_dir>/chatgpt/accounts/<sha256(client_id) hex>.json`, plus `active.json` naming the active record. Record fields follow the sign-in page example: `email`, `issuer`, `subject`, `client_id`, `ext_agent_host_id`, `id_token`, `access_token`, `refresh_token`, `token_type`, `expires_at` (from `expires_in` + receive time), `earliest_refresh_at` when present, `scopes`, `saved_at`, `label`. Written with `crate::private::write(.., 0o600)` (atomic rename, symlink checks). Directory created owner-only. A file lock per record (`config.rs` lock pattern) plus an in-process `tokio::Mutex` serializes refreshes across the daemon and terminal commands; after taking the lock the record is re-read before refreshing.

Sign-in (`oauth.rs`):

1. Refuse on Exeora Cloud machines (`!mode.is_local()`), returning `unavailable_on_cloud`. Ensure host ID exists.
2. Cancel any previous pending attempt. Bind `127.0.0.1:1455`, falling back to `127.0.0.1:0`; redirect URI `http://127.0.0.1:<port>/auth/callback` (never `localhost`, never `/callback`). Attempt expires after 10 minutes and closes the listener.
3. Fresh random `state`, `nonce`, PKCE verifier; `code_challenge = base64url(sha256(verifier))` without padding, method `S256`.
4. Parameters: `response_type=code`, `client_id` (`dynamic_agent_client` for `new`, saved issued ID for `reauth` and `enable_plan`), `agent_name_hint=Exeora` only for `new`, `ext_agent_host_id`, `redirect_uri`, `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` (always the complete set), `resource=https://api.openai.com/v1`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`. `login_hint` from the saved, validated email on reauth. `prompt=consent` only for `enable_plan` (the errors page says `force_reconsent=true` only after OpenAI confirms deployment for the integration; not used). `id_token_hint` only in the URL the CLI opens itself in the terminal flow; the URL returned to the dashboard omits it, because the hint may be sent only to the authorize endpoint and URLs carrying it must not be logged.
5. Callback (only `GET /auth/callback`): match `state` in constant time first; on `error=access_denied` stop with `plan_disabled`/declined status and no exchange; any other `error` fails the attempt; require `code`. New registration requires a callback `client_id` that is not `dynamic_agent_client`, else registration is incomplete. On reauth, a callback `client_id` different from the saved one is rejected. Response page is static ("You can close this tab"), `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, no echo of query values.
6. Exchange: form POST to the token endpoint with `grant_type=authorization_code`, issued `client_id`, `code`, `code_verifier`, same `redirect_uri`, same `resource`. No secret. `invalid_grant` discards the code and reports "start again".
7. Validate the ID token (below). For reauth, the verified `sub` must equal the saved subject, else reject without touching the saved record. Read granted scopes from the token response `scope`; `chatgpt.tokens.use.direct` present means `ready`, absent means `plan_disabled` (sign-in retained, inference refused).
8. Persist, make active, and report `newRegistration` plus an opaque per-registration `noticeId` so the dashboard shows the welcome. Status reads never consume it.

ID token (`id_token.rs`): add `jsonwebtoken` (v10, using the `aws_lc_rs` backend already in `Cargo.lock`, or `rust_crypto`; root picks after `cargo deny`/audit). Fetch JWKS from discovery `jwks_uri`, cache, refetch once on unknown `kid`. Accept only RS256, matching the verified OpenAI discovery metadata, with a compatible RSA signing JWK; never `none`/HMAC or unadvertised alternatives. Check `iss` equals discovery `issuer` exactly, `aud` contains the issued client ID, `exp` with at most 5 s skew, `nonce` equals the attempt nonce, non-empty `sub`.

Refresh: before inference or model listing when the access token expires within 5 minutes and not before `earliest_refresh_at`. Form POST `grant_type=refresh_token`, issued `client_id`, `refresh_token`, `resource`; no `scope`. Replace access token, expiry, scopes and rotated refresh token together. Unusable codes (`invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused`) clear tokens, keep `client_id`/subject/host ID, state `reconnect`. `invalid_client` sets `client_invalid`. Network or 5xx keeps everything.

Logout: record durable sign-out intent, cancel older requests, and clear access, refresh and ID tokens under local locks before provider I/O; keep the client mapping, host ID and pending welcome. Schedule detached POST `token=<refresh>`, `token_type_hint=refresh_token`, `client_id` to the discovery `revocation_endpoint`; only a provider 2xx confirms revocation, with up to three bounded attempts on network/5xx failures. No refresh token means confirmation is false. Return `revocationConfirmed`.

Models (`models.rs`): `GET /v1/models` with the bearer; parse `models[]`, keep `visibility == "list"`, server order, `slug` as id and `display_name` as label, cap 50, cache 10 minutes per registration, drop on account switch. No curated merge and no hardcoded default model.

Inference (`inference.rs`): body exactly `{ model, instructions, input: [{ role: "user", content: [{ type: "input_text", text }] }], store: false, stream: true }`, headers `Authorization: Bearer`, `Content-Type: application/json`, `Accept: text/event-stream`, no redirects, one 60 s end-to-end deadline covering refresh, model discovery, retries, response headers and streaming. Without a model, use the first listed model; a model not in the catalog returns `model_unavailable`. Stream handling: accumulate `response.output_text.delta` up to 200 000 chars; success only on `response.completed` (deltas, else completed output text); `response.failed` maps `response.error.code`; `response.incomplete` maps to `incomplete`; an `error` event maps its code; EOF without a terminal event is `interrupted`. Pre-stream non-2xx: parse an `error` object for `code`/`param`, otherwise treat `{"detail": ...}` as diagnostic only (not shown verbatim, since bodies may echo the prompt); map by status 401/403/503 per the errors page. Capture `x-request-id` or `openai-request-id`. On a 401 before the stream, refresh once and retry once; a second 401 returns `reconnect` without erasing credentials. No retry on 429, 400 or 403.

| OpenAI result | `reason` |
| --- | --- |
| `subscription_sharing_usage_limit_exceeded` (429, also as `response.failed`) | `usage_limit` |
| `subscription_sharing_user_not_eligible` (403) | `not_eligible` |
| `subscription_sharing_usage_unavailable`, `subscription_sharing_user_unavailable` (503), direct-admission 503 | `temporarily_unavailable` |
| `subscription_sharing_unsupported_capability` (400) | `unsupported` (with `param`) |
| `subscription_sharing_route_not_supported` (403) | `route_not_supported` |
| `subscription_sharing_invalid_user` (401), direct-admission 401 after one refresh | `reconnect` |
| `chatpass_v2_scope_not_authorized`, `chatpass_v2_invalid_authorization_context` (403) | `permission` |
| direct-admission 403 without code | `region_or_policy` |

Daemon wiring (`connection.rs`): add `CHATGPT_V1` to `announced_features(local)` only when `local`; route `chatgpt_*` before project lookup in `spawn_workspace_call`; never log action payloads or results for these actions.

Terminal commands: `exeora chatgpt login [--no-browser] [--enable-plan]`, `exeora chatgpt status`, `exeora chatgpt models`, `exeora chatgpt logout`. `--no-browser` prints the URL and an SSH hint (`ssh -L 1455:127.0.0.1:1455 <host>`; only the port may vary, so the printed port must match the listener).

### 7.4 Gateway (`apps/gateway`)

- `db/schema-ai.ts`: add `"chatgpt"` to `AI_PROVIDER_IDS` (text columns, no CHECK constraint in `0025_ai_assist.sql`, so no table rewrite). `chatgpt` never gets an `ai_providers` row.
- `ai/providers/openai.ts`: delete all Codex constants, device flow, `codexAuth`, OAuth `refresh`, Codex model discovery and the `chatgpt-account-id` header. `authKinds: ["api_key"]`, label "OpenAI API". API-key generation and `/v1/models` `data[]` listing stay.
- `ai/providers/index.ts`: `PROVIDERS` keeps `openai` and `xai`; `chatgpt` is a machine-bound entry offered when `chatgpt` is in `AI_ASSIST_PROVIDERS`; it does not need `CLOUD_CREDENTIALS_KEY` because no ChatGPT credential enters the gateway. API-key and xAI providers require that encryption key. `AI_ASSIST_OAUTH=off` now only affects xAI.
- `ai/chatgpt.ts` (new): resolves an owned, non-revoked, `kind = "local"` device (`/api/devices/:deviceId/ai/chatgpt*`) or a project target (`/api/projects/:id/ai/chatgpt?workspace=` via `ownedTarget`), dispatches the actions above through `callRelayWorkspace`, and maps values to responses. Routes: `GET` status, `POST login` `{mode}`, `POST login/cancel`, `POST logout`, `GET models`. Offline machine: `409 ai_machine_offline`; missing feature: `409 ai_update_cli`; cloud device: `409 ai_chatgpt_unavailable_on_cloud`.
- `ai/routes-generate.ts`: when the resolved provider is `chatgpt`, after building the prompt dispatch `chatgpt_generate` to the same target device instead of calling a provider, inside the existing audit. Error codes stay content-free (`AI_USAGE_LIMIT`, ...). Confirm the relay workspace-call deadline is at least `GENERATE_TIMEOUT_MS` for this action. Provider resolution keeps today's order and never substitutes another provider after a ChatGPT failure.
- `ai/routes.ts` `aiFailure`: new kinds and HTTP mapping: `usage_limit` 429 `ai_usage_limit` with `manageUsageUrl`, `not_eligible` 403 `ai_not_eligible`, `plan_disabled` 409 `ai_plan_disabled`, `legacy` 409 `ai_legacy_reconnect`, `signed_out`/`reconnect` 409 `ai_chatgpt_signin` with `deviceId`, `temporarily_unavailable` 503, others 502; each includes `requestId` when the machine returned one. Messages never quote OpenAI bodies.
- `GET /api/ai`: add `chatgpt` with `machineBound: true`, `linked: null`; for `openai` with an `oauth` row return `linked: { kind: "oauth", legacy: true, accountLabel }`. Generation with provider `openai` and an `oauth` row returns `ai_legacy_reconnect` without decrypting the token.
- `POST /api/ai/providers/openai/device*`: return `ai_oauth_unavailable` (openai no longer has `oauth`).
- Rate limiting: count non-GET `/api/devices/:id/ai/` on `RL_WRITE` like `/api/ai/`.
- `wrangler.jsonc`: include `chatgpt` in `AI_ASSIST_PROVIDERS` for the selected local-machine flow; both gateway ownership checks and CLI mode checks refuse Exeora Cloud. Removing `chatgpt` disables dashboard orchestration without deleting local credentials.

### 7.5 Dashboard (`apps/web/dashboard`)

Keep the existing `AiProvidersCard` layout and `Row`/`Badge`/`btn` primitives; no visual redesign.

- `api-ai.ts`: `AiProviderId` gains `"chatgpt"`; `AiProviderView` gains `machineBound?` and `linked.legacy?`; add `chatgptStatus`, `chatgptLogin`, `chatgptCancel`, `chatgptLogout`, `chatgptModels` (device and project variants).
- `AiProvidersCard.tsx`: a "ChatGPT plan" row whose body lists local machines from `/api/machines` with per-machine state; the OpenAI row becomes "OpenAI API" (API key only, plus legacy state). Replace the "unofficial" disclaimer for ChatGPT with: "Requests use your ChatGPT plan on the machine that runs them. Exeora never receives your ChatGPT tokens." Keep the Grok disclaimer.
- `ChatgptLoginDialog.tsx` (replaces `AiDeviceLoginDialog` for ChatGPT; Grok keeps the old one): starts the attempt, then shows an "Open ChatGPT sign-in" link (`target="_blank" rel="noopener noreferrer"`, user gesture, avoids popup blocking), polls status every 2 s until `ready`, `plan_disabled`, failure or `expiresAt`, and explains "Open this on <machine>. On another computer, run `exeora chatgpt login` there."
- `ChatgptWelcomeProvider.tsx`: one host per authenticated dashboard/panel root, queues distinct device/notice IDs, holds while sign-in is open, survives route navigation and deduplicates workspace widgets. Project status includes the owned Exeora `deviceId` as HTTP metadata only; it never exposes a ChatGPT client ID.
- `ChatgptWelcomeDialog.tsx`: shown when foreground login or machine status reports `newRegistration && planUsage` with an opaque `noticeId`. Got it/Escape sends an owner-bound `chatgpt_welcome_ack` to the local machine. A stable per-registration UUID survives refresh and reauthentication; an old notice cannot clear another registration. Acknowledgement retries are idempotent. A transport error offers retry or Close for now, leaving the notice pending on the machine. The UI suppresses repeated display during the current authenticated UI session after dismissal. Human CLI login prints and flushes the usage explanation before acknowledgement; JSON login and all status reads leave it pending.
- `GenerateButton.tsx`, `CommitAssist.tsx`, `CreatePullRequest.tsx`: show `chatgpt` as a choice when offered; when it is the selected provider show "Using ChatGPT plan" with a "Manage usage" link beside the button; map `ai_chatgpt_signin` to opening the login dialog for the returned device, and `ai_usage_limit` to a compact card ("Usage limit reached", primary "Manage usage", ChatGPT identity visible, no app-credits action because Exeora sells none).
- `AiOperationSettingsForm.tsx`: for `chatgpt`, models come from `chatgptModels` of a chosen ready machine; empty model means "first available model on the machine".

UX states for the ChatGPT row, per machine:

| State | Copy | Actions |
| --- | --- | --- |
| Gateway does not offer `chatgpt` | Row hidden; legacy OpenAI row says "Your gateway has not enabled Sign in with ChatGPT." | Remove old link, Use an API key |
| No local machine / offline | "Connect a machine with the Exeora CLI to use your ChatGPT plan." | none |
| CLI without `chatgpt-v1` | "Update the Exeora CLI on <machine> to sign in with ChatGPT." | copy `exeora upgrade` |
| Exeora Cloud machine | "Not available on Exeora Cloud machines." | none |
| `signed_out` | "Use your ChatGPT plan for commit messages and pull requests on this machine." | Continue with ChatGPT |
| `pending` | dialog above | Open ChatGPT sign-in, Cancel |
| `ready` | badge "ChatGPT plan", account label/email, "Plan usage allowed" | Manage usage, Sign out |
| `plan_disabled` (declined permission) | badge "Plan usage off": "You signed in but did not allow plan usage." | Enable ChatGPT plan usage (`enable_plan`), Use an OpenAI API key |
| `reconnect` / disconnected | badge "Sign in again": "ChatGPT no longer accepts this machine's session." | Continue with ChatGPT (`reauth`) |
| `client_invalid` | "This machine's ChatGPT registration is no longer valid." | Continue with ChatGPT (`new`) |
| Last generation `not_eligible` | "ChatGPT plan usage isn't available for this account or workspace." | Manage usage, Use an OpenAI API key |
| Sign out without confirmed revocation | toast: "Signed out here. OpenAI did not confirm revocation; you can disconnect Exeora in ChatGPT settings." | Manage usage |
| Legacy OpenAI `oauth` row | badge "Old sign-in": "This link used an unofficial ChatGPT sign-in Exeora no longer supports. Sign in with ChatGPT on your machine, or use an API key." | Remove old link, Use an API key |

### 7.6 Migration

1. Release order follows the repository guards: merge and deploy the checked gateway/protocol changes, then tag and publish CLI 0.21.0. An older CLI lacks `chatgpt-v1` and the UI shows the update state during that interval; the gateway advertisement remains at the last actually published CLI until artifact verification. An older gateway never sends the new actions.
2. Gateway deploy: Codex code removed; `openai`/`oauth` rows stay encrypted and untouched but are never decrypted or sent anywhere; they surface as legacy. Settings that name `openai` keep working for API-key links and return `ai_legacy_reconnect` for legacy links; operation settings are not rewritten to `chatgpt` because that changes the billing path.
3. Migration `0027_ai_chatgpt_official.sql`: `DELETE FROM ai_device_logins WHERE provider = 'openai';` (in-flight Codex device logins, ephemeral).
4. Follow-up release after the rollback window: migration deleting `ai_providers` rows where `provider = 'openai' AND auth_kind = 'oauth'`, plus the legacy UI branch. Until then "Remove old link" (existing `DELETE /api/ai/providers/openai`) deletes a row on demand. The Codex tokens are not revoked remotely because the only way would be the undocumented Codex client.
5. Rollback: reverting the gateway restores the old behavior for untouched legacy rows; CLI ChatGPT files are independent and harmless to an old gateway.

### 7.7 Security notes

- Secrets stay on the host in owner-only files; never in logs, `--json` events, relay frames, D1, or dashboard responses. Redact authorization URLs that contain `id_token_hint`.
- Only the owner's dashboard session reaches the new routes (`ownedTarget` or device ownership); `chatgpt_*` are not reachable through MCP, account-scoped clients or the generic workspace routes, so a third-party MCP client cannot spend plan usage.
- Loopback listener binds `127.0.0.1` only, serves one path, one pending attempt, 10-minute lifetime, constant-time `state` comparison, no reflected input.
- `chatgpt_generate` accepts text only, bounded sizes, no tools, no extra Responses fields; the CLI builds the body itself rather than forwarding JSON.
- Network calls never follow redirects (same rule as `providers/http.ts`) and refuse discovery endpoints off `auth.openai.com`.

## 8. Implementation tasks

Tasks 1–6 describe the implemented scope. Final review and release validation remain in progress; task 7 is a separate future release.

1. Protocol: `workspace-chatgpt.ts`, `CHATGPT_V1`, `WorkspaceAction` union, value schemas, `workspaceTab`, regenerate Rust types. Files: `packages/protocol/src/{workspace-chatgpt.ts,workspace.ts,workspace-features.ts,index.ts}`, `crates/exeora-cli/src/generated/*`.
2. CLI ChatGPT service: `crates/exeora-cli/src/chatgpt/*`, `Cargo.toml` (`jsonwebtoken`), `lib.rs`.
3. CLI wiring: `connection.rs` (feature, pre-lookup routing, no logging), `cli.rs` (`chatgpt` subcommands).
4. Gateway: `db/schema-ai.ts`, `ai/providers/{openai.ts,index.ts,types.ts}`, `ai/chatgpt.ts`, `ai/routes.ts`, `ai/routes-generate.ts`, `api/workspace.ts` (reject `chatgpt_*`), rate-limit wiring, `migrations/0027_ai_chatgpt_official.sql`.
5. Dashboard: `api-ai.ts`, `AiProvidersCard.tsx`, `ChatgptLoginDialog.tsx`, `ChatgptWelcomeDialog.tsx`, `GenerateButton.tsx`, `CommitAssist.tsx`, `pull-request/CreatePullRequest.tsx`, `AiOperationSettingsForm.tsx`.
6. Docs: `docs/self-hosting.md` AI Assist section, `apps/web/landing/src/pages/docs/ai-assist.astro`, CLI readme; remove "unofficial" ChatGPT wording, keep Grok's.
7. Follow-up (separate release): legacy purge migration and UI branch removal.

## 9. Tests

CLI (Rust, mock HTTP server, no live OpenAI calls):
- Authorize URL: new vs reauth vs enable_plan parameters; `agent_name_hint` only on new; full scope set; `resource`; S256 challenge; `127.0.0.1` and `/auth/callback`; dashboard URL never contains `id_token_hint`.
- Callback: wrong/missing `state` rejected before anything else; `access_denied` makes no token request; missing `code`; new registration without `client_id` or with `dynamic_agent_client`; reauth with a different `client_id` rejected.
- ID token: bad signature, wrong `iss`, wrong `aud`, expired, wrong `nonce`, `alg: none`/HS256 all rejected; unknown `kid` triggers one JWKS refetch; reauth with a different `sub` keeps the old record.
- Scopes: token response without `chatgpt.tokens.use.direct` gives `plan_disabled` and `chatgpt_generate` refuses without a network call.
- Store: files are `0600` on Unix, atomic, host ID stable across logins, record per client ID, `dynamic_agent_client` never persisted.
- Refresh: correct form fields without `scope`; rotation replaces all fields together; concurrent refreshes from two tasks perform one request; each unusable code clears tokens and keeps the mapping; `invalid_client`; 5xx keeps tokens; `earliest_refresh_at` respected.
- Logout: revocation form fields; 200 confirmed; 5xx retried then `revocationConfirmed: false`; tokens cleared either way, host ID and client mapping kept.
- Models: `models[]` with `visibility` filter and order preserved; a `data[]` body is not mistaken for the account catalog.
- Inference: exact request body (no `max_output_tokens`, `temperature`, `metadata`, `user`, system item); deltas plus `response.completed` succeed; `response.failed` with each documented code maps per table; `response.incomplete`; `error` event; EOF without terminal event is `interrupted`; pre-stream `{"detail"}` 401/403/503; request ID captured; 401 then refresh then retry once; output cap.
- Feature announced only in local mode; actions refused on cloud mode.

Gateway (workers tests with fake relay and fetch):
- No request ever targets `chatgpt.com` or the device-auth endpoints (fetch fake asserts host allowlist).
- `chatgpt` offered only when listed in `AI_ASSIST_PROVIDERS`; `AI_ASSIST_OAUTH=off` no longer affects it.
- Generic `/workspace/reads` and `/workspace/actions` reject every `chatgpt_*` action.
- Device routes refuse another user's device, revoked devices and cloud devices.
- Generation with `chatgpt` dispatches `staged_context` then `chatgpt_generate` to the same device; each failure reason maps to its HTTP code and body; no fallback provider is called after a ChatGPT failure; audit records only the error code.
- Legacy `openai`/`oauth` row: listed as legacy, generation returns `ai_legacy_reconnect` without decrypting or fetching, `DELETE` removes it; API-key OpenAI and Grok tests unchanged.
- Migration applies on a database with legacy device logins.

Dashboard (unit + Playwright E2E with mocked API):
- Each state in 7.5 renders its copy and actions; "Continue with ChatGPT" label exact.
- Login dialog and background status cannot consume the welcome. A displayed welcome is acknowledged explicitly; reauth/enable-plan preserve a pending notice, and a different registration rejects its acknowledgement.
- Usage-limit card with primary "Manage usage" to `https://chatgpt.com/settings/usage`; "Using ChatGPT plan" indicator beside generate when ChatGPT is selected.
- `plan_disabled` offers enable-plan and API-key choices; legacy row offers removal.

Manual, with a real Plus/Pro account (cannot be proven by mocks): first registration on a laptop, reauth with saved client ID, decline then enable plan usage, generation, model list, logout and revocation, SSH-tunnel sign-in for a headless machine.

## 10. Assumptions

- The selected scope is the documented open-source CLI flow, confirmed by the owner. No hosted partner client ID or hosted plan-token entitlement is assumed; credentials and inference stay on the user's local host (decision 5.1).
- Port `1455` may be taken (Codex uses it); the docs allow any port as long as scheme, host and path match, so fallback to an ephemeral port is compliant.
- The relay accepts a device-level `workspace.call` with a placeholder `projectId` (`z.string()` in `messages.ts`); if the DO or CLI needs a real project, the device route passes any project the user owns on that device.
- `revocation_endpoint` and `jwks_uri` are read from discovery at runtime; nothing beyond the documented authorize/token URLs is hardcoded.
- Model slugs are never hardcoded for ChatGPT; the example slug on the docs page is not used as a default.

## 11. Follow-ups

- `exeora chatgpt import` for the documented self-hosted VM transfer (preserve the VM's own host ID).
- Account picker for multiple registrations per machine (`exeora chatgpt accounts|use`, dashboard menu); the store already keys by client ID.
- Hosted option A if OpenAI provisions a partner client.
