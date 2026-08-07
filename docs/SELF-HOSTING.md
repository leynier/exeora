# Self-hosting Exeora

Run your own Exeora gateway on Cloudflare Workers with your own domain, database and OAuth app. The hosted product at [exeora.dev](https://exeora.dev) is the same code.

For a shorter version of this guide on the website, see [exeora.dev/docs/self-hosting](https://exeora.dev/docs/self-hosting/).

## License note

Exeora is AGPL-3.0. If you modify it and offer it as a network service, you must offer the corresponding source to the users of that service. See [LICENSE](../LICENSE).

## What you need

- A Cloudflare account with Workers, D1 and KV
- A domain on Cloudflare (or any zone you can point at Workers)
- A GitHub OAuth App whose callback hits your gateway
- Node 22+ and [Bun](https://bun.sh)

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

## 3. Create a GitHub OAuth App

An OAuth App admits one callback URL, so keep a separate app for local development if you need one.

- Homepage: your base URL (for example `https://your.example.com`)
- Callback: `https://your.example.com/oauth/callback/github`

## 4. Set Worker secrets

```bash
bun run secret GITHUB_CLIENT_ID
bun run secret GITHUB_CLIENT_SECRET
bun run secret COOKIE_SECRET
bun run secret REQUEST_STATE_SECRET
```

Generate the two secrets with `openssl rand -hex 32`, and use different values than development. `REQUEST_STATE_SECRET` signs approvals that travel through an AI client; keep it separate from `COOKIE_SECRET` on purpose.

## 5. Administrators

On a fresh database, the **first account to sign in becomes the admin**. That person can open the administration panel and act on every account. Protect that first sign-in the same way you would protect any root account.

To name operators ahead of time instead, set the Worker var `ADMIN_EMAILS` to a comma-separated list:

```jsonc
// apps/gateway/wrangler.jsonc, under "vars":
"ADMIN_EMAILS": "you@example.com,ops@example.com"
```

Matching addresses are promoted when they register; everyone else stays ordinary. It is a var, not a secret. Leave it unset to keep the first-user rule.

## 6. Migrate and deploy

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
| `COOKIE_SECRET` | `openssl rand -hex 32` |
| `REQUEST_STATE_SECRET` | `openssl rand -hex 32`, different from the cookie secret |

The GitHub ones are named `GH_OAUTH_*` because GitHub refuses repository secrets whose name begins with `GITHUB_`. The workflow renames them to the names the Worker reads.

## 7. Point the CLI at your gateway

```bash
EXEORA_GATEWAY_URL=https://your.example.com npx @exeora/cli connect
```

Without that, the published CLI talks to `https://exeora.dev`.

## Local development

See [CONTRIBUTING.md](../CONTRIBUTING.md).
