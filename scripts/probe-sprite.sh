#!/usr/bin/env bash
# Looks at a machine and says what it has, for whoever decides what goes in
# the table of apps/gateway/src/cloud/tools.sh. Paste it into a terminal on a
# real instance, or run `bash probe-sprite.sh`.
#
# It changes nothing: it installs nothing, writes no file, and never runs
# apt-get other than as a simulation. Tools that would fetch, cache or log
# something on being asked their version are told not to, and those written
# in JavaScript are not run at all: their version is read from the
# package.json beside them. The one trace it can leave is not its own: sudo
# keeps a directory under /run from the moment it is asked anything.
set -uo pipefail

# The PATH the service runs with, as apps/gateway/src/cloud/bootstrap.ts has it.
SERVICE_PATH="$HOME/.local/bin:/.sprite/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
APT_PACKAGES="unzip zip make build-essential tmux"
export DEBIAN_FRONTEND=noninteractive
export RUSTUP_AUTO_INSTALL=0
export GH_NO_UPDATE_NOTIFIER=1
export GH_TELEMETRY=false
export DO_NOT_TRACK=1

section() { printf '\n== %s\n' "$*"; }
limited() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then timeout -k 2 "$seconds" "$@"; else "$@"; fi
}
first_line() { grep -v '^[[:space:]]*$' | head -n 1 || true; }

# Where a command is for this shell and for the service, and what it says
# its version is.
look() { # command, the arguments that make it print its version
  local name="$1" here there version
  shift
  here="$(command -v "$name" 2>/dev/null || true)"
  there="$(PATH="$SERVICE_PATH" command -v "$name" 2>/dev/null || true)"
  if [ -z "$here" ] && [ -z "$there" ]; then
    printf '%-10s missing\n' "$name"
    return 0
  fi
  version="$(limited 15 "${here:-$there}" "$@" </dev/null 2>&1 | first_line)"
  printf '%-10s %s | service: %s | %s\n' "$name" "${here:--}" "${there:-not on its PATH}" "${version:-no output}"
}

# The same for a tool that is a package of JavaScript, which is not run: npm
# would write its logs, yarn a cache, corepack what it downloads.
look_package() { # command
  local name="$1" here there real dir version="" depth
  here="$(command -v "$name" 2>/dev/null || true)"
  there="$(PATH="$SERVICE_PATH" command -v "$name" 2>/dev/null || true)"
  if [ -z "$here" ] && [ -z "$there" ]; then
    printf '%-10s missing\n' "$name"
    return 0
  fi
  real="$(readlink -f "${here:-$there}" 2>/dev/null || true)"
  dir="$(dirname "${real:-/}")"
  for depth in 1 2 3; do
    if [ -r "$dir/package.json" ]; then
      version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/package.json" | head -n 1)"
      break
    fi
    dir="$(dirname "$dir")"
  done
  printf '%-10s %s | service: %s | %s\n' "$name" "${here:--}" "${there:-not on its PATH}" "${version:-not run, and no package.json beside $real (depth $depth)}"
}

section "system"
if [ -r /etc/os-release ]; then cat /etc/os-release; else echo "no /etc/os-release"; fi
printf 'uname -m: %s\n' "$(uname -m 2>&1)"
printf 'kernel: %s\n' "$(uname -sr 2>&1)"
printf 'user: %s\n' "$(id 2>&1)"
printf 'HOME: %s\n' "${HOME:-unset}"
printf 'shell: bash %s\n' "${BASH_VERSION:-unknown}"
printf 'libc: %s\n' "$(ldd --version 2>&1 | first_line)"
printf 'PATH: %s\n' "$PATH"
printf 'service PATH: %s\n' "$SERVICE_PATH"
if [ -d /run/systemd/system ]; then echo "systemd: running"; else echo "systemd: not running"; fi

section "root"
if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo: not installed"
elif limited 15 sudo -n true </dev/null >/dev/null 2>&1; then
  echo "sudo -n true: works"
else
  echo "sudo -n true: does not work"
fi

section "apt"
if ! command -v apt-get >/dev/null 2>&1; then
  echo "apt-get: not installed"
else
  printf 'apt-get: %s\n' "$(command -v apt-get)"
  printf 'package lists on disk: %s\n' "$(find /var/lib/apt/lists -maxdepth 1 -name '*_Packages*' 2>/dev/null | wc -l)"
  # What an update would fetch, without fetching it, and whether the first
  # few of those answer. Nothing is written: curl sends the body nowhere.
  uris="$(limited 30 apt-get update --print-uris 2>/dev/null </dev/null | sed -n "s/^'\([^']*\)'.*/\1/p" | grep 'InRelease$' | head -n 4 || true)"
  if [ -z "$uris" ]; then
    echo "mirrors: apt-get names none (no sources, or --print-uris is refused)"
  elif ! command -v curl >/dev/null 2>&1; then
    printf 'mirrors: no curl to try them with\n%s\n' "$uris"
  else
    for uri in $uris; do
      if code="$(curl -sS -o /dev/null -L --connect-timeout 10 --max-time 20 -w '%{http_code}' "$uri" </dev/null 2>&1)"; then
        printf 'mirror %s: answered %s\n' "$uri" "$code"
      else
        printf 'mirror %s: not reached (%s)\n' "$uri" "$(printf '%s' "$code" | first_line)"
      fi
    done
  fi
  echo "simulated install of: $APT_PACKAGES"
  # shellcheck disable=SC2086
  limited 60 apt-get -s -q install --no-install-recommends $APT_PACKAGES </dev/null 2>&1 | tail -n 6
fi

section "tools of the table"
look gh --version
if [ -e "$HOME/.local/share/exeora/bin/gh" ]; then
  printf '%-10s %s | %s\n' "gh (real)" "$HOME/.local/share/exeora/bin/gh" "$(limited 15 "$HOME/.local/share/exeora/bin/gh" --version </dev/null 2>&1 | first_line)"
else
  printf '%-10s not at %s\n' "gh (real)" "$HOME/.local/share/exeora/bin/gh"
fi
look uv --version
look jq --version
look rg --version
look yq --version
look git-lfs --version
look_package pnpm
look_package yarn
look unzip -v
look zip -v
look make --version
look cc --version
look tmux -V

section "what the installers need"
look curl --version
look tar --version
look gzip --version
look sha256sum --version
look mktemp --version
look timeout --version
look readlink --version
look git --version

section "runtimes"
look node --version
look_package npm
look_package corepack
look python3 --version
look go version
look rustc --version
look java -XX:-UsePerfData -version
look bun --version
look deno --version
look docker --version

section "/dev/shm"
if [ -r /proc/mounts ] && grep -E '^[^ ]+ /dev/shm ' /proc/mounts; then
  df -h /dev/shm 2>&1
else
  echo "/dev/shm is not a mount of its own"
fi

section "disk"
df -h / "$HOME" /tmp 2>&1

section "memory and processors"
grep -E '^(MemTotal|MemAvailable|SwapTotal):' /proc/meminfo 2>&1
printf 'processors: %s\n' "$(nproc 2>&1)"

section "cgroups"
# By what is mounted, not by `stat -f`: the coreutils of Ubuntu 25.10 do not
# know the name of the cgroup2 filesystem.
if [ -e /sys/fs/cgroup/cgroup.controllers ]; then
  echo "cgroup version: 2"
  printf 'controllers: %s\n' "$(cat /sys/fs/cgroup/cgroup.controllers 2>&1)"
  printf 'handed down: %s\n' "$(cat /sys/fs/cgroup/cgroup.subtree_control 2>&1)"
elif grep -q ' cgroup ' /proc/mounts 2>/dev/null; then
  echo "cgroup version: 1"
else
  echo "cgroup version: none mounted"
fi
grep -E ' cgroup2? ' /proc/mounts 2>/dev/null | head -n 5
if [ -r /proc/self/cgroup ]; then
  printf 'this shell is in: %s\n' "$(tr '\n' ' ' </proc/self/cgroup)"
fi

printf '\nprobe: done, nothing was changed\n'
