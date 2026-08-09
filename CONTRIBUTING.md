# Contributing

Thanks for looking at the source. This file is how to run Exeora locally, check a change, and release the CLI.

## Layout

| Path | What it is |
|---|---|
| `packages/protocol` | Tool contract (zod) and relay wire format. Shared by CLI and gateway. |
| `packages/design` | Design tokens used by the landing, dashboard and OAuth screens. |
| `crates/exeora-cli` | Native Rust `exeora` binary and high-performance local tool executor. |
| `crates/exeora-protocol-gen` | Checked-in Rust types generated from the canonical Zod schemas. |
| `packages/cli` | Compatible Node.js CLI published as [`@exeora/cli`](https://www.npmjs.com/package/@exeora/cli). |
| `apps/gateway` | Cloudflare Worker: OAuth, MCP, relay, dashboard API, static site. |
| `apps/web` | Astro landing + docs, React dashboard. Built here, served by the gateway. |

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

### Checks

```bash
bun run typecheck
bun run test      # node and workerd projects
bun run check     # Biome
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
bun run bench:tools                 # Rust vs TypeScript, all ten tool calls
bun run check:tool-performance      # same comparison and overall CI gate
```

The TypeScript schemas remain canonical. Run `bun run protocol:rust` after changing anything under `packages/protocol`; CI regenerates the JSON contract and Rust types and fails if the checked-in output drifts.

The tool performance comparison excludes fixture creation and runner startup,
warms both engines, and reports median per-call latency from equivalent
operations. Its speedup is `TypeScript latency / Rust latency`, so values above
`1.00x` favor Rust. CI gates on the geometric mean instead of requiring every
individual call to win, because subprocess scheduling is noisy on shared
runners.

The gateway's tests run inside workerd through `@cloudflare/vitest-pool-workers`, so the Durable Object, WebSocket hibernation and D1 are the real implementations rather than stand-ins.

## Trying it end to end

With the gateway running:

```bash
bun run --cwd packages/cli build
export EXEORA_GATEWAY_URL=http://localhost:8787

# connect signs in, registers the machine and registers the directory,
# skipping whichever of those is already done.
node packages/cli/bin/index.mjs connect
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
cd packages/cli && npm version patch --workspaces=false
git commit -am "release: cli v0.1.1" && git tag cli-v0.1.1
git push && git push --tags
```

The tag triggers `.github/workflows/release-cli.yml`, which runs the same CI, checks that the tag agrees with both manifests, publishes npm and crates.io packages, builds native Linux, macOS Intel, macOS Apple Silicon and Windows binaries, and attaches checksums to a GitHub release. npm uses trusted publishing over OIDC; crates.io uses `CARGO_REGISTRY_TOKEN`.

A stable tag must also agree with `LATEST_CLI_VERSION` in `apps/gateway/wrangler.jsonc`; the release workflow refuses to publish otherwise, so bumping the var and letting it deploy is part of the release, not an afterthought. Prerelease tags are exempt, since a prerelease should not be advertised as the newest CLI.

Publishing uses npm provenance over OIDC (`npm publish --provenance`). The package points at this repository.

Releases are deliberately not tied to `main`: the gateway deploys on every push, the CLI ships when a tag says so.

Set `LATEST_CLI_VERSION` in `apps/gateway/wrangler.jsonc` to the version being published. The gateway tells it to every executor in the `hello.ack`, and `connect` prints a line when a newer one exists. It is told rather than looked up so connecting never depends on the npm registry being reachable.

**Adding to the protocol does not break installed CLIs.** The relay serves the range `MIN_SUPPORTED_PROTOCOL_VERSION` to `PROTOCOL_VERSION`, and anything a newer CLI gained is negotiated: the executor announces `capabilities` in its `hello`, and the gateway advertises only the tools it named. Raise `MIN_SUPPORTED_PROTOCOL_VERSION` only for a change an old CLI would get actively *wrong*, as opposed to one it would merely not have, and expect that to disconnect everyone below it. Merge first so the gateway deploys, then tag, never the other way around.

The CLI version must agree between `packages/cli/package.json`, the workspace version in `Cargo.toml`, and `LATEST_CLI_VERSION` for stable releases. tsdown substitutes the npm version into the bundle, while Rust reads it from Cargo at compile time.

## Pull requests

- Keep changes focused; match the tone and structure of nearby code.
- Run `bun run check`, `bun run typecheck` and `bun run test` before opening a PR.
- Security issues: email hello@exeora.dev (see [SECURITY.md](./SECURITY.md)), do not open a public issue.
