# Self-hosting Exeora

Run your own Exeora gateway on Cloudflare Workers with your own domain, database and OAuth app. The hosted product at [exeora.dev](https://exeora.dev) is the same code.

For a shorter version of this guide on the website, see [exeora.dev/docs/self-hosting](https://exeora.dev/docs/self-hosting/).

## License note

Exeora is AGPL-3.0. If you modify it and offer it as a network service, you must offer the corresponding source to the users of that service. See [LICENSE](../LICENSE).

## What you need

- A Cloudflare account with Workers, D1, KV, Pipelines and R2 Data Catalog
- A domain on Cloudflare (or any zone you can point at Workers)
- A GitHub OAuth App, Google OAuth client, or both, whose callbacks hit your gateway
- Node 22+ and [Bun](https://bun.sh)
- A recurring runner for archive maintenance; the repository includes a GitHub Actions workflow

## 1. Clone and install

```bash
git clone https://github.com/leynier/exeora.git
cd exeora
bun install
```

## 2. Create the Cloudflare resources

Put the returned ids into `apps/gateway/wrangler.jsonc`. Ids are not secrets.

```bash
bunx wrangler d1 create exeora
bunx wrangler kv namespace create OAUTH_KV
```

Also set `EXEORA_BASE_URL` and the `routes` pattern in that file to your hostname, and create a proxied DNS record for it. A single `AAAA` on `@` pointing at `100::` with the proxy on is enough; nothing ever connects to that address.

## 3. Create identity provider credentials

Configure at least one provider. A provider appears on the sign-in screen only when both of its secrets are present.

### GitHub

An OAuth App admits one callback URL, so keep a separate app for local development if you need one.

- Homepage: your base URL (for example `https://your.example.com`)
- Callback: `https://your.example.com/oauth/callback/github`

### Google

Create a Web application client in Google Auth Platform. Request only `openid email profile` and register this exact redirect URI:

- Redirect URI: `https://your.example.com/oauth/callback/google`

Google clients admit multiple redirect URIs, but separate production and development clients keep their secrets isolated.

## 4. Set Worker secrets

```bash
bun run secret GITHUB_CLIENT_ID
bun run secret GITHUB_CLIENT_SECRET
bun run secret GOOGLE_CLIENT_ID
bun run secret GOOGLE_CLIENT_SECRET
bun run secret COOKIE_SECRET
bun run secret REQUEST_STATE_SECRET
```

Generate the two secrets with `openssl rand -hex 32`, and use different values than development. `REQUEST_STATE_SECRET` signs approvals that travel through an AI client; keep it separate from `COOKIE_SECRET` on purpose.

### Exeora Cloud (optional)

Cloud puts repositories on [Fly.io Sprites](https://sprites.dev) your organization pays for. It stays off until both of these are set:

```bash
bun run secret SPRITES_TOKEN
bun run secret CLOUD_CREDENTIALS_KEY
```

`SPRITES_TOKEN` is an organization token from `sprite login` (the `org/id/secret` form). `CLOUD_CREDENTIALS_KEY` is 32 random bytes as 64 hex characters (`openssl rand -hex 32`) that encrypt repository tokens at rest; rotating it invalidates the stored ones, which `exeora cloud` and the dashboard can set again. The Worker var `CLOUD_SPRITE_PREFIX` names the machines (`exeora-<device>` by default) and is what the five-minute cron uses to find orphans, so keep it unique per gateway that shares the organization.

Cloud needs a public `EXEORA_BASE_URL`: a machine dials the gateway from outside, so a development server on `localhost:8787` cannot host it. The bootstrap installs the CLI at `LATEST_CLI_VERSION` through your gateway's own installer, so publish a CLI release of at least the version in `CLOUD_MIN_CLI_VERSION` (`packages/protocol/src/cloud.ts`) and announce it before creating the first machine; provisioning refuses an older one with a `cli_unsupported` error. Once the secrets are in place, enable Cloud for an account from its page in the administration panel; administrators have it without being enabled.

## 5. Administrators

On a fresh database, the **first account to sign in becomes the admin**. That person can open the administration panel and act on every account. Protect that first sign-in the same way you would protect any root account.

To name operators ahead of time instead, set the Worker var `ADMIN_EMAILS` to a comma-separated list:

```jsonc
// apps/gateway/wrangler.jsonc, under "vars":
"ADMIN_EMAILS": "you@example.com,ops@example.com"
```

Matching addresses are promoted when they register; everyone else stays ordinary. It is a var, not a secret. Leave it unset to keep the first-user rule.

## 6. Provision the required audit archive

Tool execution first persists an intent to the Pipelines stream, with a durable D1 outbox as fallback, and uses an Iceberg archive in R2 for queryable history. The archive is not an optional analytics add-on: Activity, usage limits, retention and account erasure depend on it.

Follow [`apps/gateway/pipelines/readme.md`](../apps/gateway/pipelines/readme.md) to create the Pipeline, its bucket and the matching versioned table, then copy the generated stream binding and archive coordinates into `apps/gateway/wrangler.jsonc`.

Create separate read-only and read-write R2 Data Catalog tokens. Only the read-only token reaches the Worker:

```bash
bun run secret AUDIT_R2_SQL_TOKEN
bun run secret AUDIT_MAINTENANCE_SECRET
```

Use the same random `AUDIT_MAINTENANCE_SECRET` in the Worker and maintenance runner. The included `.github/workflows/audit-maintenance.yml` also needs these repository secrets:

| Secret | Value |
|---|---|
| `AUDIT_CATALOG_URI` | R2 Data Catalog REST URI |
| `AUDIT_R2_WAREHOUSE` | Warehouse identifier from the catalog |
| `AUDIT_R2_MAINTENANCE_TOKEN` | Separate Admin Read & Write catalog token |
| `GATEWAY_URL` | Your public gateway origin |
| `AUDIT_MAINTENANCE_SECRET` | The same random value set on the Worker |

If neither the stream nor the D1 fallback acknowledges the intent, a tool is not executed. A failed outcome send stays queued for retry. Archive erasure is claimed with leases and needs two successful catalog passes at least 24 hours apart; retention pauses automatically unless the usage rollup has consumed every complete day through yesterday.

## 7. Migrate and deploy

```bash
bun run db:migrate
bun run deploy
```

`deploy` builds the landing and dashboard, then deploys the Worker. The Worker serves the built site through its `ASSETS` binding.

### Continuous deploy (this repository)

Every push to `main` runs CI and, if it passes, applies the D1 migrations, builds the site and deploys the Worker (`.github/workflows/deploy.yml`). `workflow_dispatch` triggers the same run by hand.

Repository secrets under Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Workers Scripts, KV, D1, Zone Workers Routes) |
| `CLOUDFLARE_ACCOUNT_ID` | Account owning the zone |
| `GH_OAUTH_CLIENT_ID` | Production GitHub OAuth client id |
| `GH_OAUTH_CLIENT_SECRET` | Production GitHub OAuth client secret |
| `GOOGLE_CLIENT_ID` | Production Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | Production Google OAuth client secret |
| `COOKIE_SECRET` | `openssl rand -hex 32` |
| `REQUEST_STATE_SECRET` | `openssl rand -hex 32`, different from the cookie secret |
| `AUDIT_MAINTENANCE_SECRET` | Random maintenance secret, also used by the nightly workflow |

The GitHub ones are named `GH_OAUTH_*` because GitHub refuses repository secrets whose name begins with `GITHUB_`. The workflow renames them to the names the Worker reads. Google secrets keep the names the Worker uses.

Provision `AUDIT_R2_SQL_TOKEN` directly on the Worker with `bun run secret`, as described above. It is deliberately not copied into GitHub Actions; Wrangler preserves existing Worker secrets when deploying new code.

## 8. Point the CLI at your gateway

The published CLI talks to `https://exeora.dev` until you tell it otherwise. Tell it once:

```bash
exeora gateway use https://your.example.com
exeora connect
```

Or in one step, which is the same thing followed immediately by `connect`:

```bash
exeora connect --gateway https://your.example.com
```

The choice is stored, so every later command talks to your gateway with no flag and no variable. `exeora gateway` prints the active one, and `exeora gateway reset` goes back to the hosted one.

One gateway is active at a time. Switching forgets the machine registration, the projects and the session belonging to the previous one, because a device id issued by one gateway's database means nothing to another; the CLI says what it is about to forget and asks first.

`EXEORA_GATEWAY_URL` still works and outranks the stored value, which makes it the right tool for one shell or one command rather than for living on a self-hosted gateway.

## Local development

See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Audit storage

Confirmed stream ingestion is the normal fail-closed boundary; D1 is the fallback outbox. Accepted outbox rows are retained for 24 hours and then removed. Undelivered rows remain available for recovery. Iceberg readers resolve the intent and final outcome into one execution and deduplicate retries by the same stable id. Setup is in [`apps/gateway/pipelines/readme.md`](../apps/gateway/pipelines/readme.md), and the full contract is in [`audit-architecture.md`](audit-architecture.md).

Free Activity shows a rolling 24 hours, while physical cleanup is asynchronous. Catalog maintenance, snapshots, stream buffering and undelivered retries have separate lifetimes; a one-day visibility window is not a guarantee that every stored copy disappears within one day.

Erasing an account from that archive needs a job that cannot run inside a Worker, because R2 SQL cannot delete. A self-hosted deployment therefore needs the included workflow or an equivalent recurring runner; without it, deletion debts and retention remain visible but undrained.
