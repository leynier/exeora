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
checksum, and then place `exeora` on the user's `PATH`.

Upgrade an existing installation with `exeora upgrade`. It resolves the
latest stable GitHub release, verifies the published SHA-256 checksum, and
replaces the current executable in place on Linux, macOS, and Windows.
