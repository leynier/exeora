#!/usr/bin/env bash
# Exercises apps/gateway/src/cloud/bootstrap.sh the way a machine runs it: the
# payload prepended as a quoted heredoc and the whole thing fed to `bash -s`,
# with a fake installer on PATH and no sudo. Then runs the run.sh it leaves
# behind against a local bare repository, twice, so a cold wake is covered too.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
script="$here/apps/gateway/src/cloud/bootstrap.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT INT TERM
fake_bin="$root/bin"
mkdir -p "$fake_bin"

fail() { printf 'test-cloud-bootstrap: %s\n' "$*" >&2; exit 1; }

# curl serves the installer, which is what install.sh would be minus the
# download: an `exeora` that answers --version and records how it was run.
cat > "$root/installer.sh" <<'EOF_INSTALLER'
mkdir -p "$EXEORA_INSTALL_DIR"
{
  echo '#!/bin/sh'
  echo 'case "$1" in'
  echo "  --version) echo \"exeora $EXEORA_VERSION\" ;;"
  echo '  *) printf "%s\n" "$@" > "$HOME/.exeora/connect-args" ;;'
  echo 'esac'
} > "$EXEORA_INSTALL_DIR/exeora"
chmod +x "$EXEORA_INSTALL_DIR/exeora"
EOF_INSTALLER
cat > "$fake_bin/curl" <<EOF_CURL
#!/usr/bin/env sh
# The runtime socket is not here; a hold is a no-op, like on a laptop.
case "\$*" in *--unix-socket*) echo "\$*" >> "$root/hold-calls"; exit 0 ;; esac
echo "\$*" >> "$root/curl-calls"
cat "$root/installer.sh"
EOF_CURL
# No root here: the script has to keep going without memory limits.
printf '#!/usr/bin/env sh\nexit 1\n' > "$fake_bin/sudo"
chmod +x "$fake_bin/curl" "$fake_bin/sudo"

# The repository the machine clones, reached through the https URL the
# payload names: git rewrites it to the bare repository on disk.
origin="$root/origin.git"
seed="$root/seed"
git init -q --bare -b main "$origin"
git init -q -b main "$seed"
git -C "$seed" -c user.name=seed -c user.email=seed@example.test commit -q --allow-empty -m init
git -C "$seed" push -q "$origin" main
git -C "$seed" checkout -q -b feature/existing
git -C "$seed" -c user.name=seed -c user.email=seed@example.test commit -q --allow-empty -m existing
git -C "$seed" push -q "$origin" feature/existing
# A base with a character the gateway accepts and a plain allowlist would not.
git -C "$seed" push -q "$origin" feature/existing:refs/heads/hotfix+1
# A branch whose name ends like a shorter one: a pattern would take one for the other.
git -C "$seed" push -q "$origin" feature/existing:refs/heads/topic/new-short
existing_commit="$(git -C "$seed" rev-parse feature/existing)"

REPO_URL="https://example.test/widgets.git"
TOKEN="exm_abcdefghijklmnopqrstuv_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"

payload() {
  # $1 branch, $2 createBranchFrom ("" for none), $3 machine token, $4 "public" for no credential
  local from="" credential=',"credential":{"username":"x-access-token","secret":"ghp_test"}'
  [ -n "$2" ] && from=",\"createBranchFrom\":\"$2\""
  [ "${4:-}" = public ] && credential=""
  cat <<EOF_PAYLOAD
{"gatewayUrl":"https://exeora.test","installUrl":"https://exeora.test/linux/install.sh","cliVersion":"1.2.3","machineToken":"$3","repoUrl":"$REPO_URL","branch":"$1"$from$credential,"cliConfig":{"gatewayUrl":"https://exeora.test","deviceId":"dev_test","deviceName":"cloud-test","projects":[{"id":"prj_test","slug":"widgets","name":"Widgets","root":"/home/sprite/workspace"}],"workspaces":[],"workspaceRoot":"/home/sprite/workspaces"}}
EOF_PAYLOAD
}

# Runs the bootstrap exactly as the gateway sends it, in the machine's HOME.
bootstrap() {
  local home="$1" payload="$2"
  mkdir -p "$home"
  # The rewrite lives in the machine's global git config, where the
  # bootstrap's own `git config --global` lines land too.
  HOME="$home" git config --global "url.$origin.insteadOf" "$REPO_URL"
  {
    printf 'set -euo pipefail\numask 077\nmkdir -p "$HOME/.exeora"\n'
    printf 'cat > "$HOME/.exeora/payload.json" <<'"'"'__EXEORA_PAYLOAD__'"'"'\n'
    printf '%s\n' "$payload"
    printf '__EXEORA_PAYLOAD__\n'
    cat "$script"
  } | HOME="$home" PATH="$fake_bin:$PATH" bash -s
}

run_service() {
  HOME="$1" PATH="$fake_bin:$PATH" bash "$1/.exeora/run.sh"
}

# A new branch, created from the default branch.
home_a="$root/machine-a"
out="$(bootstrap "$home_a" "$(payload feature/new main "$TOKEN")")"
[ "$(printf '%s\n' "$out" | tail -n 1)" = "EXEORA_BOOTSTRAP_OK" ] || fail "no sentinel: $out"
[ "$(cat "$home_a/.config/exeora/machine-token")" = "$TOKEN" ] || fail "token not written"
[ "$(stat -c %a "$home_a/.config/exeora/machine-token")" = "600" ] || fail "token mode"
[ "$(stat -c %a "$home_a/.config/exeora/config.json")" = "600" ] || fail "config mode"
grep -q '"deviceId": "dev_test"' "$home_a/.config/exeora/config.json" || fail "config.json lacks the device"
[ ! -e "$home_a/.exeora/payload.json" ] || fail "payload left behind"
[ "$(cat "$home_a/.config/exeora/git-token")" = "ghp_test" ] || fail "git token not written"
helper="$(HOME="$home_a" git config --global credential.https://example.test.helper)"
[ "$helper" = "$home_a/.config/exeora/git-credential-helper" ] || fail "credential helper not wired: $helper"
[ "$(HOME="$home_a" "$home_a/.config/exeora/git-credential-helper" get)" = "$(printf 'username=x-access-token\npassword=ghp_test')" ] || fail "helper output"
[ "$(wc -l < "$root/curl-calls")" = "1" ] || fail "installer not fetched once"

# Bootstrapping again is a no-op that still ends well and installs nothing.
out="$(bootstrap "$home_a" "$(payload feature/new main "$TOKEN")")"
[ "$(printf '%s\n' "$out" | tail -n 1)" = "EXEORA_BOOTSTRAP_OK" ] || fail "second bootstrap failed"
[ "$(wc -l < "$root/curl-calls")" = "1" ] || fail "installer fetched again"

run_service "$home_a"
[ -d "$home_a/workspace/.git" ] || fail "no clone"
[ "$(git -C "$home_a/workspace" branch --show-current)" = "feature/new" ] || fail "wrong branch"
[ "$(git -C "$home_a/workspace" config branch.feature/new.remote)" = "origin" ] || fail "branch not tracking origin"
[ "$(git -C "$home_a/workspace" config branch.feature/new.merge)" = "refs/heads/feature/new" ] || fail "branch merge ref"
[ "$(git -C "$home_a/workspace" rev-parse HEAD)" = "$(git -C "$seed" rev-parse main)" ] || fail "not started from main"
git -C "$origin" show-ref --quiet refs/heads/feature/new && fail "the new branch was pushed"
grep -qx -- '--cloud' "$home_a/.exeora/connect-args" || fail "connect --cloud not run"
grep -q "tasks/exeora-setup" "$root/hold-calls" || fail "the machine was not held awake for the clone"
# The refresher, a subshell of run.sh, did not outlive it.
if pgrep -f "$home_a/.exeora/run.sh" >/dev/null 2>&1; then fail "hold refresher left running"; fi

# A cold wake runs run.sh again: no second clone, the checkout is kept.
touch "$home_a/workspace/marker"
run_service "$home_a"
[ -e "$home_a/workspace/marker" ] || fail "re-cloned on the second run"

# A retry after the credential was removed takes the old one out, including
# a staging file an earlier run left when it failed past writing it.
printf 'ghp_stale\n' > "$home_a/.config/exeora/git-token.tmp"
bootstrap "$home_a" "$(payload feature/new main "$TOKEN" public)" >/dev/null
[ ! -e "$home_a/.config/exeora/git-token" ] || fail "stale git token kept"
[ ! -e "$home_a/.config/exeora/git-token.tmp" ] || fail "stale staging file kept"
[ ! -e "$home_a/.config/exeora/git-credential-helper" ] || fail "stale helper kept"
if HOME="$home_a" git config --global credential.https://example.test.helper >/dev/null 2>&1; then
  fail "stale helper still configured"
fi

# A branch the remote already has is checked out as it is.
home_b="$root/machine-b"
bootstrap "$home_b" "$(payload feature/existing "" "$TOKEN")" >/dev/null
run_service "$home_b"
[ "$(git -C "$home_b/workspace" branch --show-current)" = "feature/existing" ] || fail "existing branch not checked out"
[ "$(git -C "$home_b/workspace" rev-parse HEAD)" = "$existing_commit" ] || fail "existing branch at the wrong commit"

# A branch created from another ref starts there, even when an earlier run
# got as far as the clone and no further.
home_c="$root/machine-c"
bootstrap "$home_c" "$(payload feature/from-existing hotfix+1 "$TOKEN")" >/dev/null
HOME="$home_c" git clone -q "$REPO_URL" "$home_c/workspace"
run_service "$home_c"
[ "$(git -C "$home_c/workspace" branch --show-current)" = "feature/from-existing" ] || fail "interrupted checkout not finished"
[ "$(git -C "$home_c/workspace" rev-parse HEAD)" = "$existing_commit" ] || fail "createBranchFrom ignored"
[ -f "$home_c/workspace/.git/exeora-checkout-ready" ] || fail "no checkout marker"

# A base the repository does not have fails the bootstrap for good, in words
# the gateway can pass on; a commit id is left for run.sh to resolve.
home_e="$root/machine-e"
if out="$(bootstrap "$home_e" "$(payload feature/orphan nope "$TOKEN")" 2>&1)"; then
  fail "a base the remote lacks was accepted"
fi
printf '%s\n' "$out" | grep -q "EXEORA_BOOTSTRAP_FATAL The base nope" || fail "no fatal reason for a missing base: $out"
home_f="$root/machine-f"
bootstrap "$home_f" "$(payload feature/by-commit "$existing_commit" "$TOKEN")" >/dev/null
run_service "$home_f"
[ "$(git -C "$home_f/workspace" rev-parse HEAD)" = "$existing_commit" ] || fail "commit base ignored"
# A base that vanished between bootstrap and the first run stops the run.
home_g="$root/machine-g"
bootstrap "$home_g" "$(payload feature/late-base feature/existing "$TOKEN")" >/dev/null
printf 'vanished\n' > "$home_g/.exeora/fields/createBranchFrom"
if run_service "$home_g" >/dev/null 2>&1; then fail "a vanished base was substituted"; fi
[ ! -f "$home_g/workspace/.git/exeora-checkout-ready" ] || fail "checkout marked ready on a missing base"

# A branch the remote already has needs no base, even one that is gone.
home_h="$root/machine-h"
bootstrap "$home_h" "$(payload feature/existing gone-base "$TOKEN")" >/dev/null
run_service "$home_h"
[ "$(git -C "$home_h/workspace" rev-parse HEAD)" = "$existing_commit" ] || fail "existing branch refused over its unused base"

# `new-short` is new although `topic/new-short` exists: created from the default branch.
home_i="$root/machine-i"
bootstrap "$home_i" "$(payload new-short main "$TOKEN")" >/dev/null
run_service "$home_i"
[ "$(git -C "$home_i/workspace" branch --show-current)" = "new-short" ] || fail "new-short not checked out"
[ "$(git -C "$home_i/workspace" rev-parse HEAD)" = "$(git -C "$seed" rev-parse main)" ] || fail "new-short taken for topic/new-short"

# The main machine's branch is the project's default, and it has to exist.
home_j="$root/machine-j"
if out="$(bootstrap "$home_j" "$(payload nope "" "$TOKEN")" 2>&1)"; then
  fail "a default branch the remote lacks was accepted"
fi
printf '%s\n' "$out" | grep -q "EXEORA_BOOTSTRAP_FATAL The branch nope" || fail "no fatal reason for a missing default branch: $out"

# A payload that fails validation writes nothing and exits with node's code.
home_d="$root/machine-d"
if bootstrap "$home_d" "$(payload main "" "not-a-token")" >/dev/null 2>&1; then
  fail "an invalid payload was accepted"
fi
[ ! -e "$home_d/.config/exeora/machine-token" ] || fail "token written from an invalid payload"
[ ! -e "$home_d/.exeora/run.sh" ] || fail "run.sh written from an invalid payload"

echo "cloud bootstrap: ok"
