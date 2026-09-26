# Exeora Cloud bootstrap.
#
# Runs once inside a fresh machine as the `sprite` user, fed to `bash -s` by
# the gateway with the payload already written to $HOME/.exeora/payload.json
# by the lines the gateway prepends. Installs the CLI, writes its config and
# the machine token, sets up git credentials, and leaves run.sh behind for the
# service the gateway registers next. Every step checks before it changes
# anything, so running it again after a failure is safe.
set -euo pipefail
set +x
umask 077

PAYLOAD="$HOME/.exeora/payload.json"
FIELDS="$HOME/.exeora/fields"
CONF="$HOME/.config/exeora"
BIN="$HOME/.local/bin"

log() { printf 'bootstrap: %s\n' "$*"; }
fail() { printf 'bootstrap: error: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node is not installed on this machine"
command -v git >/dev/null 2>&1 || fail "git is not installed on this machine"
command -v curl >/dev/null 2>&1 || fail "curl is not installed on this machine"
[ -f "$PAYLOAD" ] || fail "no payload at $PAYLOAD"

# The payload is parsed once, by node, which validates every field and leaves
# one file per value for the shell to read. Nothing here ever expands a value
# from the payload on a command line.
# Staging files of an earlier run that failed past this point would otherwise
# be taken for this payload's: a token since removed, installed once more.
rm -rf "$FIELDS"
rm -f "$CONF/machine-token.tmp" "$CONF/config.json.tmp" "$CONF/git-token.tmp"
mkdir -p "$FIELDS" "$CONF" "$BIN" "$HOME/.exeora"
node - "$PAYLOAD" "$FIELDS" "$CONF" <<'__EXEORA_NODE__'
const [payloadPath, fields, conf] = process.argv.slice(2);
const fs = require("node:fs");
const path = require("node:path");
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const need = (name, ok) => {
  if (!ok) {
    console.error(`bootstrap: error: invalid payload field ${name}`);
    process.exit(3);
  }
};
const isId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const isUrl = (value) => typeof value === "string" && /^https?:\/\/\S+$/.test(value);
need("gatewayUrl", isUrl(payload.gatewayUrl));
need("installUrl", isUrl(payload.installUrl));
need("repoUrl", typeof payload.repoUrl === "string" && /^https:\/\/\S+$/.test(payload.repoUrl));
need("machineToken", typeof payload.machineToken === "string" && /^exm_[A-Za-z0-9]+_[A-Za-z0-9_-]{16,}$/.test(payload.machineToken));
const isRef = (value) => typeof value === "string" && value.length > 0 && value.length < 256 && !/[\s~^:?*\[\\\x7f]|\.\.|^-|\/$|@\{/.test(value);
need("branch", isRef(payload.branch));
need("createBranchFrom", payload.createBranchFrom === undefined || isRef(payload.createBranchFrom));
need("cliVersion", typeof payload.cliVersion === "string" && /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/.test(payload.cliVersion));
need("cliConfig", payload.cliConfig && isId(payload.cliConfig.deviceId) && Array.isArray(payload.cliConfig.projects));
const write = (name, value) => fs.writeFileSync(path.join(fields, name), String(value), { mode: 0o600 });
write("gatewayUrl", payload.gatewayUrl);
write("installUrl", payload.installUrl);
write("repoUrl", payload.repoUrl);
write("branch", payload.branch);
write("createBranchFrom", payload.createBranchFrom ?? "");
write("cliVersion", payload.cliVersion);
write("gitHost", new URL(payload.repoUrl).host);
fs.writeFileSync(path.join(conf, "machine-token.tmp"), `${payload.machineToken}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(conf, "config.json.tmp"), `${JSON.stringify(payload.cliConfig, null, 2)}\n`, { mode: 0o600 });
if (payload.credential) {
  need("credential", typeof payload.credential.username === "string" && /^[^\s:@/]{1,200}$/.test(payload.credential.username) && typeof payload.credential.secret === "string" && payload.credential.secret.length > 0);
  write("gitUsername", payload.credential.username);
  fs.writeFileSync(path.join(conf, "git-token.tmp"), `${payload.credential.secret}\n`, { mode: 0o600 });
}
__EXEORA_NODE__
field() { cat "$FIELDS/$1"; }

# The CLI, pinned to the version the gateway announces, through the same
# installer a laptop uses. Skipped when that exact version is already here.
WANT="$(field cliVersion)"
have() { "$BIN/exeora" --version 2>/dev/null | grep -Fq "$WANT"; }
if ! have; then
  log "installing exeora $WANT"
  curl -fsSL --proto '=https' --tlsv1.2 "$(field installUrl)" | EXEORA_VERSION="$WANT" EXEORA_INSTALL_DIR="$BIN" sh
fi
have || fail "the CLI did not install"

# Config and token into place, each in one rename so the CLI never reads a
# half-written file. The lock is the CLI's own, meaningless on a new machine.
mv -f "$CONF/machine-token.tmp" "$CONF/machine-token"
mv -f "$CONF/config.json.tmp" "$CONF/config.json"
rm -f "$CONF/config.json.lock"

# Git credentials for a private repository: a helper that reads two files
# outside the checkout, wired to the repository's host and nothing else. A
# payload without one is also how a credential that was removed reaches a
# retried machine, so what an earlier run left is taken out again.
if [ ! -f "$CONF/git-token.tmp" ]; then
  rm -f "$CONF/git-token" "$CONF/git-username" "$CONF/git-credential-helper"
  git config --global --unset-all "credential.https://$(field gitHost).helper" 2>/dev/null || true
fi
if [ -f "$CONF/git-token.tmp" ]; then
  mv -f "$CONF/git-token.tmp" "$CONF/git-token"
  printf '%s\n' "$(field gitUsername)" > "$CONF/git-username"
  cat > "$CONF/git-credential-helper" <<'__EXEORA_HELPER__'
#!/bin/sh
[ "$1" = get ] || exit 0
printf 'username=%s\npassword=%s\n' "$(cat "$HOME/.config/exeora/git-username")" "$(cat "$HOME/.config/exeora/git-token")"
__EXEORA_HELPER__
  chmod 700 "$CONF/git-credential-helper"
  git config --global "credential.https://$(field gitHost).helper" "$CONF/git-credential-helper"
  git config --global credential.useHttpPath false
fi
git config --global push.autoSetupRemote true
git config --global user.name >/dev/null 2>&1 || git config --global user.name "Exeora Cloud"
git config --global user.email >/dev/null 2>&1 || git config --global user.email "cloud@exeora.dev"

# A base named by branch or tag is looked for on the remote now, with the
# credentials just set up, so a misspelt one fails here in seconds rather
# than as a machine that came up on the wrong branch. Only when it will be
# used: a workspace branch the remote already has is checked out as it is,
# base or no base. A commit id cannot be asked for this way; run.sh resolves
# it after the clone, or fails there.
# A machine without a base is the project's main one, on its default branch:
# that branch has to exist, since nothing here may invent it. A repository
# whose work is on `master` and a project set up as `main` is refused now, in
# words, rather than served from a branch the remote has never seen.
FROM="$(field createBranchFrom)"
if branch="$(git ls-remote "$(field repoUrl)" "refs/heads/$(field branch)" 2>/dev/null)"; then
  if [ -z "$branch" ] && [ -z "$FROM" ]; then
    echo "EXEORA_BOOTSTRAP_FATAL The branch $(field branch) does not exist in the repository."
    exit 4
  fi
  if [ -z "$branch" ] && [ -n "$FROM" ] && ! printf '%s' "$FROM" | grep -Eq '^[0-9a-f]{7,40}$' \
    && refs="$(git ls-remote "$(field repoUrl)" "refs/heads/$FROM" "refs/tags/$FROM" 2>/dev/null)" \
    && [ -z "$refs" ]; then
    echo "EXEORA_BOOTSTRAP_FATAL The base $FROM is not a branch or tag of the repository."
    exit 4
  fi
fi

# What the service runs: bring the checkout up to date, then become the CLI.
# A cold wake runs this again from the top, so it clones only once and never
# touches a checkout that holds another repository. The branch is set up in
# a second step with a marker of its own, so a run that cloned and then died
# finishes the job next time instead of serving whatever the clone left.
cat > "$HOME/.exeora/run.sh" <<'__EXEORA_RUN__'
#!/bin/bash
set -euo pipefail
FIELDS="$HOME/.exeora/fields"
WS="$HOME/workspace"
READY="$WS/.git/exeora-checkout-ready"
REPO="$(cat "$FIELDS/repoUrl")"
BRANCH="$(cat "$FIELDS/branch")"
FROM="$(cat "$FIELDS/createBranchFrom")"
# Nothing inbound reaches the machine while it clones, and the CLI's own hold
# starts only once it runs: a task with the runtime keeps it awake until then,
# refreshed from the side and left to expire once the CLI has taken over.
hold() {
  curl -sf --unix-socket /.sprite/api.sock -X PUT -H 'Content-Type: application/json' \
    -d '{"expire":"5m"}' http://sprite/v1/tasks/exeora-setup >/dev/null 2>&1 || true
}
hold
( while sleep 120; do hold; done ) &
HOLDER=$!
trap 'kill "$HOLDER" 2>/dev/null || true' EXIT
if [ ! -d "$WS/.git" ]; then
  git clone "$REPO" "$WS"
elif [ "$(git -C "$WS" config --get remote.origin.url)" != "$REPO" ]; then
  # The stored value, not `remote get-url`: that one applies insteadOf
  # rewrites and would not compare equal to what was cloned.
  echo "run: $WS holds another repository" >&2
  exit 1
fi
if [ ! -f "$READY" ]; then
  git -C "$WS" fetch --prune origin
  # The exact remote-tracking ref, just fetched: a pattern would also match
  # a longer name ending the same way, such as topic/<branch>.
  if git -C "$WS" rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null; then
    git -C "$WS" checkout -B "$BRANCH" "origin/$BRANCH"
  else
    # Only a workspace, which always names a base, makes a branch; the main
    # machine's branch is the project's default and has to be there already.
    # A base that cannot be found is a failure, never quietly something else.
    if [ -z "$FROM" ]; then
      echo "run: the branch $BRANCH does not exist in the repository" >&2
      exit 1
    fi
    if git -C "$WS" rev-parse --verify --quiet "origin/$FROM" >/dev/null; then BASE="origin/$FROM"
    elif git -C "$WS" rev-parse --verify --quiet "$FROM^{commit}" >/dev/null; then BASE="$FROM"
    else
      echo "run: the base $FROM is not a branch, tag or commit of the repository" >&2
      exit 1
    fi
    git -C "$WS" checkout --no-track -B "$BRANCH" "$BASE"
    git -C "$WS" config "branch.$BRANCH.remote" origin
    git -C "$WS" config "branch.$BRANCH.merge" "refs/heads/$BRANCH"
  fi
  touch "$READY"
else
  git -C "$WS" fetch --prune origin || echo "run: fetch failed, continuing with the local checkout" >&2
fi
# The refresher must not outlive this script: exec keeps the pid, not the
# children, and a stray refresher would hold the machine awake for good.
kill "$HOLDER" 2>/dev/null || true
trap - EXIT
hold
exec "$HOME/.local/bin/exeora" --json connect --cloud
__EXEORA_RUN__
chmod 700 "$HOME/.exeora/run.sh"

# Memory limits: a root helper the CLI calls through sudo on every start,
# because cgroup state does not survive a cold wake. Without sudo the CLI
# simply runs commands unlimited, and says so in its log.
cat > "$HOME/.exeora/exeora-cgroup" <<'__EXEORA_CGROUP__'
#!/bin/sh
# exeora-cgroup setup | enter <pid>: a delegated cgroup v2 subtree for the
# commands the Exeora CLI runs, owned by the CLI's user.
set -eu
root="${EXEORA_CGROUP_ROOT:-/sys/fs/cgroup/exeora}"
user="${EXEORA_CGROUP_USER:-sprite}"
setup() {
  grep -qw memory /sys/fs/cgroup/cgroup.controllers || exit 2
  grep -qw memory /sys/fs/cgroup/cgroup.subtree_control || echo +memory > /sys/fs/cgroup/cgroup.subtree_control
  mkdir -p "$root/cli"
  echo +memory > "$root/cgroup.subtree_control"
  chown -R "$user:$user" "$root"
}
case "${1:-}" in
  setup) setup ;;
  enter)
    setup
    echo "$2" > "$root/cli/cgroup.procs"
    echo -1000 > "/proc/$2/oom_score_adj"
    ;;
  *) echo "usage: exeora-cgroup setup | enter <pid>" >&2; exit 64 ;;
esac
__EXEORA_CGROUP__
if sudo -n install -o root -g root -m 0755 "$HOME/.exeora/exeora-cgroup" /usr/local/sbin/exeora-cgroup 2>/dev/null \
  && sudo -n /usr/local/sbin/exeora-cgroup setup 2>/dev/null; then
  log "memory limits enabled"
else
  log "warning: memory limits unavailable on this machine"
fi
rm -f "$HOME/.exeora/exeora-cgroup"

rm -f "$PAYLOAD"
log "done"
echo EXEORA_BOOTSTRAP_OK
