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

## ChatGPT plan usage

The upcoming CLI 0.21.0 adds the official [Sign in with ChatGPT flow for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source/). If you install the CLI from a checkout, run this from the repository root so Cargo uses the committed lockfile:

```sh
cargo install --path crates/exeora-cli --locked
```

The registration and credential files belong to the machine running this CLI. Use these commands there:

```sh
exeora chatgpt login
exeora chatgpt status
exeora chatgpt models
exeora chatgpt logout
```

An eligible ChatGPT Plus or Pro account must grant `chatgpt.tokens.use.direct` for plan usage. If you signed in without that permission, run `exeora chatgpt login --enable-plan` to grant it. The CLI calls `https://api.openai.com/v1/responses` with the local credential; the credential is never uploaded to the gateway or Exeora Cloud. ChatGPT plan usage is unavailable in `exeora connect --cloud`.

The sign-in callback is `http://127.0.0.1:<port>/auth/callback`, so the browser must run on the same machine as the CLI. On a headless or SSH machine, use `exeora chatgpt login --no-browser` there and open the printed URL through a port-forward to that machine. A ChatGPT plan failure does not fall back to an API key; choose the OpenAI API-key provider explicitly when you want that path.

An old OpenAI subscription link from Exeora's unofficial Codex flow is legacy. It is not migrated automatically; sign in again with `exeora chatgpt login` on the machine that will run the request, or use an API key. See OpenAI's [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) and [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) documentation for the provider contract.

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

A project is removed only by `exeora project remove`. One that has a repository and loses its last location, because its only location was removed, its last machine was deleted or the instance of its project root on Exeora Cloud was destroyed, stays in your account with its MCP URL, its policy and its clients, and lives nowhere until it is given a place again. `exeora project list` prints it with `nowhere` in place of its locations, and `"nowhere": true` with `--json`. Give it a place with `exeora project add .` in a checkout of it, `exeora project add owner/repo`, or `exeora project locations add <slug> --on <machine|cloud>`. The first machine it is given becomes its default location. A project that is on Exeora Cloud keeps Cloud as its default location in state `no instance`: the next call to the project root makes the instance, and so does `exeora project default <slug> --on cloud`. A directory with no remote goes with its machine, because nothing could clone it anywhere else, so `exeora project locations remove` refuses to take away its only location.

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
- `EXEORA_HOOKS_DIR` (default `~/.exeora/hooks`): where the state of the project's scripts, the scripts of its page and the requests to run one are kept.

### Scripts

A project may run two scripts in its instances: `install`, which makes a checkout ready once, and `resume`, which runs every time the instance comes back from a sleep. Each is written on the project's page or in the repository, as `.exeora/cloud_install.sh` and `.exeora/cloud_resume.sh`. A script on the page replaces the file of the same hook.

The service runs them after the gateway acknowledges its hello, one at a time, install first. `install` runs when its script is not the one that was last attempted, so one that failed is not run again until it changes or somebody asks. `resume` runs once for each time the instance came back, not once for each connection. They run with `/bin/bash` in the checkout, with no stdin, and with `CI=1`, `DEBIAN_FRONTEND=noninteractive`, `EXEORA_HOOK`, `EXEORA_HOOK_SOURCE` and, for a resume, `EXEORA_RESUME_KIND` (`cold` or `warm`) added to the environment. An install is stopped after 20 minutes and a resume after 2, with everything they started. The last 8000 bytes of output are kept.

A script may leave something running, such as a dev server. The script is over when it exits, and what it left is not killed. What is left keeps the script's output open, so send it somewhere of its own (`nohup npm run dev > dev.log 2>&1 &`) if it should outlive a restart of the service.

While a script runs, a command, a call to a proxied MCP tool and a terminal wait for it, for 30 seconds at most, and then go ahead beside it. Reading, editing and git are never held.

```sh
exeora cloud-hook status                 # what the instance remembers, as JSON
exeora cloud-hook run install|resume     # asks the service to run it again
```

`cloud-hook` is for a shell on the instance and is left out of `exeora --help`. `run` runs nothing itself: it leaves a request in `~/.exeora/hooks/requests`, which the service takes within a second, and prints the run once it is over.

### `gh`

On an instance `gh` is a short script that runs `exeora gh-shim -- "$@"`, which asks the gateway for the token of the person the project belongs to and becomes the real GitHub CLI with `GH_TOKEN` set for that one process. The real one is looked for in `EXEORA_REAL_GH`, then `~/.local/share/exeora/bin/gh`, then on the `PATH`; without one it exits 127.

The token is kept between runs only in memory, in `/dev/shm/exeora-<uid>/gh-token.json`, for 30 minutes or until five minutes before it ends, whichever is sooner. Where `/dev/shm` is not a filesystem in memory nothing is kept and the gateway is asked every time. `EXEORA_GH_CACHE_DIR` names another folder, which is used only if it is in memory too.

A caller that sets `GH_TOKEN` or `GITHUB_TOKEN` is passed through untouched, and so is any machine without `EXEORA_MACHINE_TOKEN_FILE`. When there is no token the real `gh` still runs, and the reason is printed on stderr, in one line, only when the command exits 4 (it needed a sign-in) or is `gh auth status`.

The other side is the ordinary signed-in commands above with `--on cloud`. `exeora cloud add|list|credential|remove` and `exeora cloud workspace create|remove` are their older spelling and still work.
