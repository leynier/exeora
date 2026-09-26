# Exeora CLI

Native implementation of the Exeora CLI: the `exeora` binary and the local tool
executor behind it.

It uses battle-tested crates for the hot paths: `ignore` and `globset` for
walking/filtering, `grep-searcher` for bounded streaming search, `cap-std` for
confined filesystem access, `process-wrap` and Tokio for process
lifecycle/cancellation, `tokio-tungstenite` for the relay, `jsonschema` for
generated argument validation, and `keyring` for native credential storage.

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
checksum, and then place `exeora` on the user's `PATH`. The Linux binary is
linked against glibc 2.31, so it runs on Ubuntu 20.04 LTS and later.

Upgrade an existing installation with `exeora upgrade`. It resolves the
latest stable GitHub release, verifies the published SHA-256 checksum, and
replaces the current executable in place on Linux, macOS, and Windows.

## Cloud mode

`exeora connect --cloud` is what an Exeora Cloud machine runs as a service.
It never signs in: the gateway's bootstrap writes `config.json` and a machine
token before the service starts, and the CLI reads them from disk. The mode is
also selected by `EXEORA_CLOUD=1`. It reads:

- `EXEORA_MACHINE_TOKEN_FILE` (required): the machine token, re-read on every connection attempt.
- `EXEORA_GATEWAY_URL`: the gateway the machine reports to.
- `EXEORA_CGROUP_ROOT`: a delegated cgroup v2 subtree for the commands it runs; without it commands run without a memory limit, and the log says so.
- `EXEORA_COMMAND_MEMORY_MAX` (default `6G`) and `EXEORA_COMMAND_MEMORY_TOTAL` (default `7G`): the cap on one command tree and on all of them together.
- `EXEORA_CLOUD_HTTP_PORT` (default `8080`): where `/wake` and `/healthz` answer; the gateway fetches `/wake` before it dispatches to a machine that may be asleep.
- `EXEORA_SPRITE_API_SOCKET` (default `/.sprite/api.sock`): the runtime socket the keep-awake task is refreshed through while there is work.
- `EXEORA_CLOUD_FATAL_DELAY_MS` (default `5000`): how long a fatal start-up error waits before exiting, so a broken machine does not spin through restarts.

`exeora cloud add|list|credential|remove` and `exeora cloud workspace
create|remove` are the other side: ordinary signed-in commands that manage
those machines.
