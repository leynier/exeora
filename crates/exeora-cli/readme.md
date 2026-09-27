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

## Projects and where they live

A project is one git repository. It lives in as many locations as you like: your own machines, and Exeora Cloud. One set of commands covers all of them, and `--on <machine|cloud>` says where.

```sh
exeora project add                      # the checkout you are in
exeora project add owner/repo           # clone it into this machine's projects folder
exeora project add owner/repo --on cloud
exeora project list                     # every project, its repository and its locations
exeora project locations add api --on desktop
exeora project default api --on desktop
exeora workspace create fix/login --project api --on cloud
exeora workspace list --all             # every workspace and the machine it is on
exeora machine list                     # your machines and the ones Exeora Cloud runs
```

`exeora project add` with a directory registers it where it is. When the directory is the top of a checkout with a remote, the remote is what makes it the same project on another machine: adding a checkout of a repository that is already a project joins that project as one more location. Run `exeora sync` once on a machine whose projects were added by a CLI older than 0.18.0, so Exeora learns their repositories.

Each machine has a projects folder, `~/exeora` by default. `exeora connect` asks for it the first time it runs at a terminal. Read or change it with `exeora config get|set|unset projects-root`, or set `EXEORA_PROJECTS_ROOT`. The first time a workspace is asked for on a machine that has no copy of the repository, the CLI clones it into `<projects-root>/<slug>`, or takes the checkout of the same repository that is already there. It never deletes or overwrites what it finds: a folder that holds something else is refused with a message that names it. Workspaces are Git worktrees of that clone, kept under `workspace-root` as before.

The project root is called `main` in the default location and `main@<location>` in any other that holds a copy, for example `main@desktop`. `exeora workspace list` shows one such row per location before the workspaces, and `exeora project list` shows the name beside each location. The table always shows those root rows. `exeora workspace list --json` prints workspaces only, each with `"kind": "workspace"`, because a script written for 0.17.0 reads every row as a workspace with an id; pass `--roots` to include the roots as rows with `"kind": "root"`, `"id": null` and their `selector`. With `--json` the three listings print the gateway's fields and, beside them, every key 0.17.0 printed (`id` for a machine, `root` for a project, `gitRoot`, `root` and `syncState` for a workspace), so scripts written for it keep working. When the gateway cannot be reached, `project list` and `workspace list` print what this machine knows, mark each item `"offline": true` and say so on stderr.

A clone tries, in this order and stopping at the first that works: a short-lived token from Exeora when your account is connected to GitHub, the git credentials of the machine over https, and ssh. None of them can stop to ask for a password.

`exeora cloud …` still runs, so scripts written for it keep working. It is no longer listed, because everything it does is said with the commands above.

### `exeora git-credential`

A [git credential helper](https://git-scm.com/docs/gitcredentials), run by git rather than by you, and so left out of `exeora --help`.

```sh
exeora git-credential [--project <id>] get|store|erase
```

For `get` it reads git's request from stdin and answers with a short-lived token for the repository of the project, made by the gateway for an account that is connected to GitHub. Without `--project` the project is found from the `host` and `path` git names, which needs `credential.useHttpPath` to be `true`. `store` and `erase` do nothing: the token is made on request and kept nowhere. On any failure it prints nothing to stdout, exits 0 and says why on stderr, so git moves on to the next helper. It signs in with the stored session, or with the machine token when `EXEORA_MACHINE_TOKEN_FILE` is set.

When the CLI clones with this helper and the machine's own git could not have read the repository, it writes the helper into that repository's `.git/config`, for that host only, so later fetches work. Your global git configuration is never changed.

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

The other side is the ordinary signed-in commands above with `--on cloud`. `exeora cloud add|list|credential|remove` and `exeora cloud workspace create|remove` are their older spelling and still work.
