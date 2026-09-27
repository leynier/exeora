# Contributing

Thanks for looking at the source. This file is how to run Exeora locally, check a change, and release the CLI.

## Layout

| Path | What it is |
|---|---|
| `packages/protocol` | Tool contract (zod) and relay wire format. Shared by CLI and gateway. |
| `packages/design` | Design tokens used by the landing, dashboard and OAuth screens. |
| `crates/exeora-cli` | Native Rust `exeora` binary and high-performance local tool executor. |
| `crates/exeora-protocol-gen` | Checked-in Rust types generated from the canonical Zod schemas. |
| `apps/gateway` | Cloudflare Worker: OAuth, MCP, relay, dashboard API, static site. |
| `apps/web` | Astro landing + docs, React dashboard. Built here, served by the gateway. |
| `apps/extension` | Exeora for Chrome: the dashboard's Workspace screen in Chrome's side panel, built with WXT. |

Product documentation sources live under `apps/web/landing/src/pages/docs/`, ordered by `apps/web/landing/src/lib/docs.ts`.

## Development

Requires Node 22+, [Bun](https://bun.sh), and the pinned Rust toolchain from `rust-toolchain.toml`.

```bash
bun install
bun run db:migrate:local     # applies the D1 schema locally
bun run dev                  # everything on http://localhost:8787
```

`dev` builds the landing and dashboard first. Wrangler refuses to start when the directory behind the `ASSETS` binding does not exist, so skipping that step fails outright rather than serving an empty site.

Use `bun run dev`, not `wrangler dev` directly. `wrangler dev` takes its origin from the production `routes`, which makes the OAuth issuer report `exeora.dev` while your client is talking to localhost, and a client that validates the issuer (including this CLI) will rightly reject that. The script pins it with `--local-upstream`.

### GitHub sign-in

An OAuth App admits a single callback URL, so development and production need separate apps.

1. Go to <https://github.com/settings/developers> and choose **New OAuth App**.
2. Set the homepage to `http://localhost:8787` and the callback to `http://localhost:8787/oauth/callback/github`.
3. Copy `apps/gateway/.dev.vars.example` to `apps/gateway/.dev.vars` and fill in the client id and secret, plus `COOKIE_SECRET` and `REQUEST_STATE_SECRET` (`openssl rand -hex 32` each).

Adding another identity provider later is one new file implementing `UpstreamProvider`, one entry in `apps/gateway/src/oauth/providers/index.ts`, and two secrets. No migration is needed: the `provider` column is plain TEXT and the Drizzle enum is a compile-time constraint only.

### Working on the dashboard

```bash
bun run --cwd apps/web dev:dashboard   # Vite, proxying /api and /oauth to :8787
```

### Working on the Chrome extension

```bash
bun run dev          # the gateway on :8787, in another terminal
bun run ext:dev      # WXT opens Chrome with the extension loaded and reloads it on change
```

The side panel reuses the dashboard's Workspace screen through the `@dashboard` alias, so a change under `apps/web/dashboard/src` shows up in both. A development build talks to `http://localhost:8787`; `bun run ext:build` targets `https://exeora.dev`, and `EXEORA_GATEWAY_URL` overrides either. To load a build by hand, open `chrome://extensions`, turn on developer mode and load `apps/extension/.output/chrome-mv3` unpacked.

The `key` in `apps/extension/wxt.config.ts` pins the extension id to `helnfgncjgikiojakjdfppmmflbdjamo`. Copy `EXEORA_EXTENSION_IDS` from `apps/gateway/.dev.vars.example` into your `.dev.vars` so the local gateway lets that id sign in; a build without the key gets another id, and the gateway refuses its sign-in. Production allows no id until the Chrome Web Store listing exists, and then only the store's: the committed key is public, so anyone can build an extension with that id. See [Releasing the Chrome extension](#releasing-the-chrome-extension).

Signing in asks for consent once per account and extension id, so approving one build never lets another sign in without asking. Taking an id off `EXEORA_EXTENSION_IDS` refuses its next sign-in. Revoking the extension from Settings in the dashboard signs every browser out and asks again next time, and still works after the list is emptied.

### Checks

```bash
bun run typecheck
bun run test      # node and workerd projects
bun run check     # Biome
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Critical landing and dashboard flows also have real-browser coverage. Install Chromium once, then
run the explicit suite (it is intentionally separate from the fast root test command):

```bash
bunx playwright install chromium
bun run test:e2e
```

To use an existing Chromium build instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its
executable.

The TypeScript schemas remain canonical. Run `bun run protocol:rust` after changing anything under `packages/protocol`; CI regenerates the JSON contract and Rust types and fails if the checked-in output drifts.

The gateway's tests run inside workerd through `@cloudflare/vitest-pool-workers`, so the Durable Object, WebSocket hibernation and D1 are the real implementations rather than stand-ins.

## Trying it end to end

With the gateway running:

```bash
export EXEORA_GATEWAY_URL=http://localhost:8787

# connect signs in, registers the machine and keeps it online.
# Add a directory from anywhere, including another terminal:
#   cargo run -p exeora-cli -- project add /path/to/project
cargo run -p exeora-cli -- connect
```

Then point a client at the printed URL:

```bash
bunx @modelcontextprotocol/inspector@2.1.0
# or
claude mcp add --transport http exeora <the URL>
```

Stopping `connect` should make the next tool call fail immediately with `LOCAL_EXECUTOR_OFFLINE` rather than hang. Nothing is queued, by design.

## Releasing the CLI

```bash
# bump the workspace version in Cargo.toml, then
git commit -am "release: cli v0.8.4" && git tag cli-v0.8.4
git push && git push --tags
```

The tag triggers `.github/workflows/release-cli.yml`, which runs the same CI, builds native Linux, macOS Intel, macOS Apple Silicon and Windows binaries, checks that the tag agrees with the manifest, then publishes the crates.io package and attaches the binaries plus checksums to a GitHub release. Publishing waits for every native build because a crates.io version cannot be rolled back. crates.io uses `CARGO_REGISTRY_TOKEN`.

Linux binaries are linked against glibc 2.31 (Ubuntu 20.04 LTS) with `cargo zigbuild`, so they also run on 22.04 and later. Linking on the GitHub runner's own glibc would otherwise produce a binary that refuses to start on those machines.

A stable tag must also agree with `LATEST_CLI_VERSION` in `apps/gateway/wrangler.jsonc`; the release workflow refuses to publish otherwise, so bumping the var and letting it deploy is part of the release, not an afterthought. Prerelease tags are exempt, since a prerelease should not be advertised as the newest CLI.

Releases are deliberately not tied to `main`: the gateway deploys on every push, the CLI ships when a tag says so.

Set `LATEST_CLI_VERSION` in `apps/gateway/wrangler.jsonc` to the version being published. The gateway tells it to every executor in the `hello.ack`, and `connect` prints a line when a newer one exists. It is told rather than looked up so connecting never depends on an external release service being reachable.

**Adding to the protocol does not break installed CLIs.** The relay serves the range `MIN_SUPPORTED_PROTOCOL_VERSION` to `PROTOCOL_VERSION`, and anything a newer CLI gained is negotiated: the executor announces `capabilities` in its `hello`, and the gateway advertises only the tools it named. Raise `MIN_SUPPORTED_PROTOCOL_VERSION` only for a change an old CLI would get actively *wrong*, as opposed to one it would merely not have, and expect that to disconnect everyone below it. Merge first so the gateway deploys, then tag, never the other way around.

The CLI version must agree between the workspace version in `Cargo.toml` and `LATEST_CLI_VERSION` for stable releases. Rust reads it from Cargo at compile time.

## Releasing the Chrome extension

```bash
# bump "version" in apps/extension/package.json, then
git commit -am "release: extension v0.2.0" && git tag ext-v0.2.0
git push && git push --tags
```

The tag triggers `.github/workflows/release-extension.yml`, which runs the same CI, checks that the tag agrees with `apps/extension/package.json` (the manifest takes its version from there), packages the extension without its manifest key, and submits it to the Chrome Web Store through API v2. It is published as `STAGED_PUBLISH`: once review approves it, it waits for **Publish** in the developer dashboard instead of reaching everyone at once.

A version that needs a gateway change is tagged after that change has merged and deployed, the same rule as the CLI.

What the workflow cannot do is create the item. The first version is uploaded by hand, which is when the store assigns the extension its id, and the listing, privacy answers and permission justifications are only edited in the dashboard. Once the id exists, add it to `EXEORA_EXTENSION_IDS` in `apps/gateway/wrangler.jsonc` and let it deploy before submitting, or the reviewer's sign-in is refused.

One-time setup for the workflow:

1. In a Google Cloud project, enable the Chrome Web Store API and create a service account with a JSON key.
2. In the Chrome Web Store developer dashboard, give that service account's email access to the publisher, and note the publisher id.
3. In the repository, create a `chrome-web-store` environment (with required reviewers if every submission should be approved) holding `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` and `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`.

`bun run --cwd apps/extension submit --dry-run --chrome-zip <zip>` with the same variables exported checks the credentials without uploading anything.

## Pull requests

- Keep changes focused; match the tone and structure of nearby code.
- Run `bun run check`, `bun run typecheck` and `bun run test` before opening a PR.
- Security issues: email hello@exeora.dev (see [SECURITY.md](./SECURITY.md)), do not open a public issue.
