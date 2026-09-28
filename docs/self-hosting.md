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

### GitHub repositories (optional)

With a GitHub App of your own, an account connects GitHub once and picks its repositories from a list, and machines clone with tokens that last an hour instead of one somebody pasted. It is a different thing from the OAuth App of step 3, which only signs people in. It stays off until all six of the secrets below are set, and `CLOUD_CREDENTIALS_KEY` with them; with any of the seven missing the routes answer `github_disabled` and projects clone as before.

`CLOUD_CREDENTIALS_KEY` is required here even on a gateway that does not use Exeora Cloud. What a person may list, link and clone is asked of GitHub with their own token, so that a member of an organization reaches the repositories they can open there and no others the app was given. That token has to be kept, and the key is what it is kept under: without it there is nowhere safe to keep one, so the connection stays off. Set it as described above (`openssl rand -hex 32`). Rotating it makes every connected account connect again.

Create the app at <https://github.com/settings/apps/new> (or under an organization's settings) with:

| Setting | Value |
|---|---|
| Callback URL | `https://your.example.com/api/github/callback` |
| Request user authorization (OAuth) during installation | Checked |
| Setup URL | Leave empty; GitHub disables it while the option above is checked |
| Webhook URL | `https://your.example.com/api/github/webhook`, active |
| Webhook secret | `openssl rand -hex 32`, the same value as `GITHUB_APP_WEBHOOK_SECRET` |
| Repository permissions | Contents: read and write. Metadata: read-only. Pull requests: read and write. Issues: read and write. Actions: read-only. Checks: read-only. Commit statuses: read-only. Workflows: read and write |
| Subscribe to events | Repository. The installation events, and a person revoking their authorization, are always delivered |
| Where can this app be installed | Any account, unless the gateway serves only yours |

Then generate a private key on the app's page, which downloads a `.pem`, and a client secret:

```bash
bun run secret GITHUB_APP_ID
bun run secret GITHUB_APP_SLUG
bun run secret GITHUB_APP_PRIVATE_KEY < exeora.private-key.pem
bun run secret GITHUB_APP_CLIENT_ID
bun run secret GITHUB_APP_CLIENT_SECRET
bun run secret GITHUB_APP_WEBHOOK_SECRET
```

`GITHUB_APP_SLUG` is the name in the app's public address, `github.com/apps/<slug>`. The key is accepted as GitHub downloads it (`BEGIN RSA PRIVATE KEY`) and as PKCS#8. An installation that was not given pull requests still clones and pushes: the gateway asks for a token without that permission when GitHub refuses the full one.

The permissions in the table are the ones the gateway counts on, and the list it counts them against is `APP_PERMISSIONS` in `apps/gateway/src/github/permissions.ts`: an app that grants fewer shows every installation as waiting for the rest. Contents, Metadata and Pull requests are what cloning, pushing and opening a pull request need. Workflows lets a push change the files under `.github/workflows/`, which GitHub refuses without it. Issues, Actions, Checks and Commit statuses are what `gh` reads and writes inside an instance.

For an app that already exists, the permissions are added by hand. In the App's settings, Permissions and events, set Issues to read and write, Actions, Checks and Commit statuses to read-only, and Workflows to read and write, and save. GitHub then asks the owner of each installation to accept them. Until they do, Exeora keeps working with what the installation already granted. The dashboard names what an installation has not accepted yet, and the gateway learns of an acceptance from the webhook, or the next time the account connects.

Inside an instance of Exeora Cloud, `gh` acts as the person who owns the project, with the token GitHub gave them when they connected, and the instance asks the gateway for it each time it is needed. A project that was never connected and has a token somebody pasted is given that one instead, when its repository is on github.com. Those requests are counted by instance on the rate limiter `RL_MACHINE` (thirty a minute, declared under `ratelimits` in `apps/gateway/wrangler.jsonc`), apart from the account's own `RL_WRITE`, so a script that calls `gh` in a loop cannot spend the budget its owner registers machines with. Keep the binding when you copy the configuration: without it the requests are counted on `RL_WRITE`.

Leave "Expire user authorization tokens" on, which is GitHub's default: the gateway renews a person's token before it runs out and stores the new pair. An account whose token GitHub stops accepting is asked to connect again, and reaches nothing through GitHub until it does.

A machine's token is cut down to what the project's owner can do on GitHub: none for someone who can no longer read the repository, and read-only for someone who may not push.

Connecting finishes in the browser that started it. The way back from GitHub is accepted only in a browser signed in to Exeora as the account that asked, so a link made by one person does nothing in the browser of another.

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

Every push to `main` applies the D1 migrations, builds the site and deploys the Worker (`.github/workflows/deploy.yml`). That workflow does not run CI. A pull request runs `.github/workflows/ci.yml` on the pull request SHA. A direct push to `main` and `workflow_dispatch` migrate and deploy with no CI.

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
| `GH_APP_ID`, `GH_APP_SLUG`, `GH_APP_PRIVATE_KEY`, `GH_APP_CLIENT_ID`, `GH_APP_CLIENT_SECRET`, `GH_APP_WEBHOOK_SECRET` | Optional: the GitHub App, as in step 4 |

The GitHub ones are named `GH_OAUTH_*` and `GH_APP_*` because GitHub refuses repository secrets whose name begins with `GITHUB_`. The workflow renames them to the names the Worker reads. Google secrets keep the names the Worker uses.

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

## 9. Exeora for Chrome (optional)

The Chrome extension signs in against one gateway, fixed when it is built, and the gateway only lets the extension ids it names sign in. Build it for yours:

```bash
EXEORA_GATEWAY_URL=https://your.example.com bun run ext:build
```

Then name its id in `apps/gateway/wrangler.jsonc`, comma separated if there are several. A build published to the Chrome Web Store has the id the store assigned. A build loaded unpacked has `helnfgncjgikiojakjdfppmmflbdjamo`, from the key committed in `apps/extension/wxt.config.ts`; that key is public, so anyone can make an extension with that id, and it belongs on a gateway only you use.

```jsonc
"EXEORA_EXTENSION_IDS": "<your extension id>"
```

An empty value turns the extension off: its sign-in page answers 404, and a sign-in from an id that is no longer listed is refused. Sessions it already had keep working until they are revoked from Settings in the dashboard, which still lists them.

## Local development

See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Audit storage

Confirmed stream ingestion is the normal fail-closed boundary; D1 is the fallback outbox. Accepted outbox rows are retained for 24 hours and then removed. Undelivered rows remain available for recovery. Iceberg readers resolve the intent and final outcome into one execution and deduplicate retries by the same stable id. Setup is in [`apps/gateway/pipelines/readme.md`](../apps/gateway/pipelines/readme.md), and the full contract is in [`audit-architecture.md`](audit-architecture.md).

Free Activity shows a rolling 24 hours, while physical cleanup is asynchronous. Catalog maintenance, snapshots, stream buffering and undelivered retries have separate lifetimes; a one-day visibility window is not a guarantee that every stored copy disappears within one day.

Erasing an account from that archive needs a job that cannot run inside a Worker, because R2 SQL cannot delete. A self-hosted deployment therefore needs the included workflow or an equivalent recurring runner; without it, deletion debts and retention remain visible but undrained.
