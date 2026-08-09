# Exeora CLI (Rust)

Native implementation of the Exeora CLI. It intentionally shares the public
command, wire-protocol, configuration, and credential contracts with
`@exeora/cli`.

It uses battle-tested crates for the hot paths: `ignore` and `globset` for
walking/filtering, `grep-searcher` for bounded streaming search, `cap-std` for
confined filesystem access, `process-wrap` and Tokio for process
lifecycle/cancellation, `tokio-tungstenite` for the relay, `jsonschema` for
generated argument validation, and `keyring` for native credential storage.

The public commands and the existing `exeora-nodejs` configuration locations
are preserved so users can switch implementations without re-registering
their machine or projects.

## Install

Linux:

```sh
curl -fsSL https://exeora.dev/linux/install.sh | sh
```

macOS:

```sh
curl -fsSL https://exeora.dev/macos/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://exeora.dev/windows/install.ps1 | iex
```

Both installers download the matching native release, verify its SHA-256
checksum, and then place `exeora` on the user's `PATH`.

Upgrade an existing native installation with `exeora upgrade`. It resolves the
latest stable GitHub release, verifies the published SHA-256 checksum, and
replaces the current executable in place on Linux, macOS, and Windows.

## Performance comparison

From the repository root, run:

```sh
bun run bench:tools
```

The differential benchmark invokes all ten tool calls through both the
TypeScript executor and an optimized Rust build. Both engines receive separate
copies of the same 128-file fixture, identical arguments, three warmups, and
the same sample and iteration counts. Fixture setup, edit resets, and process
cleanup are outside the measured intervals. The report shows both median
latencies, the per-tool Rust speedup, and their geometric mean.

`bun run check:tool-performance` runs the same comparison in CI and fails when
Rust is slower overall. Add `--quick` when iterating locally. Criterion remains
available through `cargo bench` for low-noise profiling inside the Rust
implementation.
