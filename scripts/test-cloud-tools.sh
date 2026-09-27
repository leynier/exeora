#!/usr/bin/env bash
# Exercises apps/gateway/src/cloud/tools.sh the way a machine runs it: wrapped
# as the gateway wraps a script and fed to `bash -s`, in a throwaway HOME, with
# nothing on PATH but fakes of curl, sudo, apt-get, npm and uname and the
# handful of real utilities the script needs. The table is the script's own,
# with two kinds of rows rewritten: the checksums, to those of the stand-ins
# the fake curl serves, and the service's PATH, to directories of the
# throwaway HOME, so that what this machine has installed is never seen.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
script="$here/apps/gateway/src/cloud/tools.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT INT TERM

label="setup"
fail() { printf 'test-cloud-tools: %s: %s\n' "$label" "$*" >&2; exit 1; }

# The real utilities, and only those, by name.
base_bin="$root/base"
mkdir -p "$base_bin"
for util in bash sh true cat mkdir rm mv cp ln chmod tar gzip sha256sum mktemp id env timeout tail grep tr cut dirname basename readlink sleep; do
  path="$(type -P "$util")" || fail "this machine lacks $util"
  ln -s "$path" "$base_bin/$util"
done

fake_bin="$root/fakes"
mkdir -p "$fake_bin" "$root/served"
cat > "$fake_bin/curl" <<EOF_CURL
#!/bin/sh
# Serves what the test put under served/, by the last part of the address. A
# file of that name under \$HOME/faults is served instead, and an empty one
# there is an address that answers 404.
echo "\$*" >> "\$HOME/calls/curl"
out=""
url=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift ;;
    --proto|--connect-timeout|--max-time|--retry|--retry-delay|--retry-max-time) shift ;;
    https://*) url="\$1" ;;
  esac
  shift
done
[ -n "\$out" ] && [ -n "\$url" ] || { echo "curl: no address or no file" >&2; exit 2; }
if [ -f "\$HOME/slow" ]; then sleep 3; fi
file="$root/served/\${url##*/}"
if [ -e "\$HOME/faults/\${url##*/}" ]; then file="\$HOME/faults/\${url##*/}"; fi
if [ ! -s "\$file" ]; then
  echo "curl: (22) The requested URL returned error: 404" >&2
  exit 22
fi
cat "\$file" > "\$out"
EOF_CURL
cat > "$fake_bin/uname" <<'EOF_UNAME'
#!/bin/sh
if [ -f "$HOME/arch" ]; then cat "$HOME/arch"; else echo x86_64; fi
EOF_UNAME
cat > "$fake_bin/sudo" <<'EOF_SUDO'
#!/bin/sh
# Answers only when asked not to prompt, and only on a machine that has it.
echo "$*" >> "$HOME/calls/sudo"
if [ "$1" != -n ]; then
  echo "sudo: called without -n" >> "$HOME/calls/prompted"
  exit 97
fi
shift
if [ ! -f "$HOME/sudo-works" ]; then
  echo "sudo: a password is required" >&2
  exit 1
fi
exec "$@"
EOF_SUDO
cat > "$fake_bin/apt-get" <<'EOF_APT'
#!/bin/sh
# Installs a package by leaving its command in the machine's system directory.
# A package named in $HOME/apt-unknown fails the whole call, as apt does.
echo "frontend=${DEBIAN_FRONTEND:-} $*" >> "$HOME/calls/apt"
if [ -f "$HOME/apt-broken" ]; then
  echo "E: Failed to fetch http://archive.test/ubuntu  Could not connect"
  exit 100
fi
mode=""
packages=""
for arg in "$@"; do
  case "$arg" in
    update | install) mode="$arg" ;;
    -* | *=*) ;;
    *) packages="$packages $arg" ;;
  esac
done
[ "$mode" = install ] || exit 0
for package in $packages; do
  if [ -f "$HOME/apt-unknown" ] && grep -qx "$package" "$HOME/apt-unknown"; then
    echo "E: Unable to locate package $package"
    exit 100
  fi
done
mkdir -p "$HOME/system/bin"
for package in $packages; do
  case "$package" in
    unzip) says="UnZip 6.00 of 20 April 2009, by Debian." ;;
    zip) says="This is Zip 3.0 (July 5th 2008), by Info-ZIP." ;;
    make) says="GNU Make 4.4.1" ;;
    build-essential) package=cc says="cc (Ubuntu 15.2.0-4ubuntu4) 15.2.0" ;;
    tmux) says="tmux 3.5a" ;;
    *) echo "E: Unable to locate package $package"; exit 100 ;;
  esac
  printf '#!/bin/sh\necho "%s"\n' "$says" > "$HOME/system/bin/$package"
  chmod 755 "$HOME/system/bin/$package"
done
EOF_APT
cat > "$fake_bin/npm" <<'EOF_NPM'
#!/bin/sh
echo "$*" >> "$HOME/calls/npm"
prefix=""
spec=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift ;;
    -* | install) ;;
    *) spec="$1" ;;
  esac
  shift
done
[ -n "$prefix" ] && [ -n "$spec" ] || exit 1
mkdir -p "$prefix/bin"
printf '#!/bin/sh\necho "%s"\n' "${spec##*@}" > "$prefix/bin/${spec%@*}"
chmod 755 "$prefix/bin/${spec%@*}"
EOF_NPM
chmod +x "$fake_bin"/*
# The same machine without npm.
bare_bin="$root/fakes-without-npm"
mkdir -p "$bare_bin"
for fake in curl uname sudo apt-get; do cp "$fake_bin/$fake" "$bare_bin/$fake"; done

# The table, as the script carries it.
rows="$(sed -n "/<<'__EXEORA_TOOLS__'/,/^__EXEORA_TOOLS__/p" "$script" | grep -E '^(path|tool|build) ' || true)"
[ -n "$rows" ] || fail "the script has no table"
field() { awk -v name="$1" -v n="$2" '$1 == "tool" && $2 == name { print $n }' <<<"$rows"; }
all_tools="$(awk '$1 == "tool" { print $2 }' <<<"$rows")"
binary_tools="$(awk '$1 == "tool" && $5 == "binary" { print $2 }' <<<"$rows")"
apt_tools="$(awk '$1 == "tool" && $5 == "apt" { print $2 }' <<<"$rows")"
[ "$(wc -l <<<"$all_tools")" = 13 ] || fail "the table does not have the thirteen tools: $all_tools"
[ "$(awk '$1 == "tool" && $4 == "yes" { print $2 }' <<<"$rows")" = gh ] || fail "gh is not the one tool that blocks"

# A stand-in for every build in the table, and the script with their checksums.
patched="$root/tools.sh"
cp "$script" "$patched"
while read -r kind name arch sha format files url; do
  [ "$kind" = build ] || continue
  printf '%s' "$sha" | grep -Eq '^[0-9a-f]{64}$' || fail "the checksum of $name for $arch is not a sha256"
  case "$url" in https://*) ;; *) fail "the address of $name for $arch is not https" ;; esac
  version="$(field "$name" 6)"
  command="$(field "$name" 3)"
  url="${url//\{version\}/$version}"
  IFS=, read -r -a members <<<"${files//\{version\}/$version}"
  served="$root/served/${url##*/}"
  stage="$root/stage"
  rm -rf "$stage"
  mkdir -p "$stage"
  for member in "${members[@]}"; do
    mkdir -p "$stage/$(dirname "$member")"
    printf '#!/bin/sh\necho "%s version %s (a stand-in for %s)"\n' "$command" "$version" "$arch" > "$stage/$member"
    chmod 755 "$stage/$member"
  done
  case "$format" in
    tar.gz) tar -czf "$served" -C "$stage" "${members[@]}" ;;
    raw) cp "$stage/${members[0]}" "$served" ;;
    *) fail "the format of $name for $arch is not known: $format" ;;
  esac
  standin="$(sha256sum "$served" | cut -d ' ' -f 1)"
  sed -i "s/$sha/$standin/" "$patched"
  grep -q "$standin" "$patched" || fail "the checksum of $name for $arch was not rewritten"
done <<<"$rows"
sed -i 's#^path .*#path  {home}/.local/bin:{home}/system/bin#' "$patched"
cat > "$root/wrap-tail.sh" <<'EOF_WRAP'
)
rc=$?
printf '\n__EXEORA_EXIT_%s__\n' "$rc"
EOF_WRAP

# The same with no time to spend, for a machine the run got to late.
late="$root/tools-late.sh"
sed 's/^BUDGET=.*/BUDGET=0/' "$patched" > "$late"
grep -qx 'BUDGET=0' "$late" || fail "the script has no budget to rewrite"

# Runs the script in a machine's HOME exactly as the gateway sends it, and
# leaves its output in $out and its exit status in $status.
run_tools() { # home, fakes, script
  local home="$1" fakes="${2:-$fake_bin}" raw
  mkdir -p "$home/calls"
  raw="$({ printf '(\n'; cat "${3:-$patched}"; printf '\n'; cat "$root/wrap-tail.sh"; } \
    | env -i HOME="$home" PATH="$fakes:$base_bin" "$base_bin/bash" -s 2>&1)" \
    || fail "the shell that was fed the script failed: $raw"
  status="$(printf '%s\n' "$raw" | sed -n 's/^__EXEORA_EXIT_\([0-9]*\)__$/\1/p' | tail -n 1)"
  [ -n "$status" ] || fail "the script ate the lines after it, or never finished: $raw"
  out="$(printf '%s\n' "$raw" | grep -v '^__EXEORA_EXIT_' || true)"
}
line_of() { printf '%s\n' "$out" | awk -v name="$1" '$1 == "EXEORA_TOOL" && $2 == name' ; }
state_of() { line_of "$1" | awk '{ print $3 }'; }
expect() { # state, tools
  local state="$1" tool
  shift
  for tool in "$@"; do
    [ "$(state_of "$tool")" = "$state" ] || fail "$tool is '$(state_of "$tool")' and not $state: $out"
  done
}
expect_ok() {
  [ "$status" = 0 ] || fail "exit $status: $out"
  [ "$(printf '%s\n' "$out" | tail -n 1)" = EXEORA_TOOLS_OK ] || fail "no sentinel at the end: $out"
}
expect_blocked() {
  [ "$status" != 0 ] || fail "exit 0 without gh: $out"
  printf '%s\n' "$out" | tail -n 1 | grep -q '^EXEORA_TOOLS_FAILED gh ' || fail "no EXEORA_TOOLS_FAILED gh at the end: $out"
  if printf '%s\n' "$out" | grep -q '^EXEORA_TOOLS_OK'; then fail "a sentinel on a run that failed: $out"; fi
}
expect_shape() {
  local count
  count="$(printf '%s\n' "$out" | grep -c '^EXEORA_TOOL ' || true)"
  [ "$count" = 13 ] || fail "$count tool lines and not 13: $out"
  if printf '%s\n' "$out" | grep '^EXEORA_TOOL ' | grep -Evq '^EXEORA_TOOL [a-z-]+ (present|installed|failed|skipped) [^ ]+ (yes|no) .+$'; then
    fail "a tool line that is not of the contract: $out"
  fi
  printf '%s\n' "$out" | grep -Eq '^EXEORA_ENV os=[^ ]+ arch=[^ ]+ sudo=(yes|no) apt=(yes|no) shm=(yes|no)$' || fail "no environment line: $out"
  if printf '%s\n' "$out" | grep -Evq '^(EXEORA_TOOL |EXEORA_ENV |EXEORA_TOOLS_OK$|EXEORA_TOOLS_FAILED |tools: )'; then
    fail "a line that is neither of the contract nor a log line: $out"
  fi
}
expect_clean() { # home
  [ "$(ls -A "$1/.local/share/exeora")" = bin ] || fail "left behind: $(ls -A "$1/.local/share/exeora")"
  [ ! -e "$1/calls/prompted" ] || fail "sudo was called in a way that could prompt"
}
calls() { if [ -f "$1" ]; then wc -l < "$1" | tr -d ' '; else echo 0; fi; }
machine() { # name: a new machine with sudo
  label="$1"
  home="$root/$1"
  mkdir -p "$home"
  touch "$home/sudo-works"
}
# shellcheck disable=SC2086
all() { expect "$1" $all_tools; }

# A new machine with sudo gets everything, in a home with no .local yet.
machine cold
run_tools "$home"
expect_ok
expect_shape
all installed
expect_clean "$home"
for tool in $binary_tools; do
  [ "$(line_of "$tool" | awk '{ print $4 }')" = "$(field "$tool" 6)" ] || fail "$tool is not at its pinned version: $(line_of "$tool")"
done
[ "$(line_of gh | awk '{ print $5 }')" = yes ] || fail "gh is not reported as blocking"
[ "$(line_of uv | awk '{ print $5 }')" = no ] || fail "uv is reported as blocking"
[ -x "$home/.local/share/exeora/bin/gh" ] || fail "gh is not at its real path"
[ ! -e "$home/.local/bin/gh" ] || fail "something was written where the shim goes"
for tool in uv uvx jq rg yq git-lfs pnpm yarn; do
  [ -x "$home/.local/bin/$tool" ] || fail "$tool is not in .local/bin"
done
[ "$(calls "$home/calls/curl")" = 6 ] || fail "not six downloads: $(cat "$home/calls/curl")"
if grep -v -- "-fsSL --proto =https --tlsv1.2 .*--max-time [0-9]* --retry [0-9]* .*amd64\|-fsSL --proto =https --tlsv1.2 .*--max-time [0-9]* --retry [0-9]* .*x86_64" "$home/calls/curl"; then
  fail "a download without its flags, or of another architecture"
fi
[ "$(grep -c ' update$' "$home/calls/apt")" = 1 ] || fail "apt-get update did not run once: $(cat "$home/calls/apt")"
[ "$(grep -c ' install ' "$home/calls/apt")" = 1 ] || fail "apt-get install did not run once: $(cat "$home/calls/apt")"
grep -q 'frontend=noninteractive .* -y .*install --no-install-recommends unzip zip make build-essential tmux$' "$home/calls/apt" \
  || fail "apt-get was not run as one quiet batch: $(cat "$home/calls/apt")"
[ "$(calls "$home/calls/npm")" = 2 ] || fail "npm did not run twice"
grep -q -- "--prefix $home/.local .*pnpm@$(field pnpm 6)\$" "$home/calls/npm" || fail "pnpm not installed under .local at its version: $(cat "$home/calls/npm")"
printf '%s\n' "$out" | grep -q '^EXEORA_ENV os=[^ ]* arch=x86_64 sudo=yes apt=yes ' || fail "the environment is not the machine's: $out"

# Again, on what is now a complete machine: everything present, nothing done.
label="cold, second run"
cp "$home/calls/curl" "$root/curl-before"
run_tools "$home"
expect_ok
expect_shape
all present
expect_clean "$home"
cmp -s "$home/calls/curl" "$root/curl-before" || fail "downloaded again"
[ "$(grep -c . "$home/calls/apt")" = 2 ] || fail "apt-get ran again"
[ "$(calls "$home/calls/npm")" = 2 ] || fail "npm ran again"

# Without sudo the apt tools are skipped, and the machine is still usable.
machine no-sudo
rm "$home/sudo-works"
run_tools "$home"
expect_ok
expect_shape
# shellcheck disable=SC2086
expect skipped $apt_tools
# shellcheck disable=SC2086
expect installed $binary_tools pnpm yarn
expect_clean "$home"
[ ! -e "$home/calls/apt" ] || fail "apt-get ran without sudo"
printf '%s\n' "$out" | grep -q ' sudo=no ' || fail "sudo reported as working: $out"
line_of unzip | grep -q 'sudo' || fail "no reason for a skipped tool: $(line_of unzip)"

# A download that is not what the table says is never installed.
machine mismatch
mkdir -p "$home/faults"
printf '#!/bin/sh\necho "jq-6.6.6"\n' > "$home/faults/jq-linux-amd64"
run_tools "$home"
expect_ok
expect_shape
expect failed jq
# shellcheck disable=SC2086
expect installed gh uv ripgrep yq git-lfs pnpm yarn $apt_tools
expect_clean "$home"
[ ! -e "$home/.local/bin/jq" ] || fail "a download with the wrong checksum was installed"
wanted="$(awk '$1 == "build" && $2 == "jq" && $3 == "x86_64" { print $4 }' "$patched")"
got="$(sha256sum "$home/faults/jq-linux-amd64" | cut -d ' ' -f 1)"
line_of jq | grep -q "expected $wanted, got $got" || fail "the reason does not name the two hashes: $(line_of jq)"
printf '%s\n' "$out" | grep '^tools: ' | grep -q "expected $wanted, got $got" || fail "the log does not name the two hashes: $out"

# Without gh the machine is not usable, and everything else is still tried.
machine no-gh
mkdir -p "$home/faults" "$home/.local/bin"
: > "$home/faults/gh_$(field gh 6)_linux_amd64.tar.gz"
printf '#!/bin/sh\n# the shim, as the rest of the system wrote it\necho "gh version 0.0.1 (shim)"\n' > "$home/.local/bin/gh"
chmod 755 "$home/.local/bin/gh"
cp -p "$home/.local/bin/gh" "$root/shim-before"
run_tools "$home"
expect_blocked
expect_shape
expect failed gh
# shellcheck disable=SC2086
expect installed uv jq ripgrep yq git-lfs pnpm yarn $apt_tools
expect_clean "$home"
[ ! -e "$home/.local/share/exeora/bin/gh" ] || fail "a gh that could not be downloaded is there"
printf '%s\n' "$out" | tail -n 1 | grep -q '404' || fail "the failure does not say why: $out"
cmp -s "$home/.local/bin/gh" "$root/shim-before" || fail "the shim was changed on a run that failed"
# The same with a gh that is not the one pinned.
machine gh-mismatch
mkdir -p "$home/faults"
printf 'not a release\n' > "$home/faults/gh_$(field gh 6)_linux_amd64.tar.gz"
run_tools "$home"
expect_blocked
expect failed gh
expect_clean "$home"
[ ! -e "$home/.local/share/exeora/bin/gh" ] || fail "a gh with the wrong checksum was installed"

# Without uv, and only uv, it is.
machine no-uv
mkdir -p "$home/faults"
: > "$home/faults/uv-x86_64-unknown-linux-gnu.tar.gz"
run_tools "$home"
expect_ok
expect_shape
expect failed uv
# shellcheck disable=SC2086
expect installed gh jq ripgrep yq git-lfs pnpm yarn $apt_tools
expect_clean "$home"

# The shim is never read as gh, written, replaced or removed.
machine shim
mkdir -p "$home/.local/bin"
printf '#!/bin/sh\n# the shim, as the rest of the system wrote it\necho "gh version 0.0.1 (shim)"\n' > "$home/.local/bin/gh"
chmod 755 "$home/.local/bin/gh"
cp -p "$home/.local/bin/gh" "$root/shim-before"
before="$(stat -c '%i %Y %a %s' "$home/.local/bin/gh")"
run_tools "$home"
expect_ok
expect installed gh
cmp -s "$home/.local/bin/gh" "$root/shim-before" || fail "the shim was changed"
[ "$(stat -c '%i %Y %a %s' "$home/.local/bin/gh")" = "$before" ] || fail "the shim was replaced by a copy of itself"
[ ! -L "$home/.local/share/exeora/bin/gh" ] || fail "the real gh is a link, to the shim or to something else"
grep -q "gh_$(field gh 6)_linux_amd64.tar.gz" "$home/calls/curl" || fail "the shim was taken for gh, and gh not downloaded"
run_tools "$home"
expect_ok
all present
cmp -s "$home/.local/bin/gh" "$root/shim-before" || fail "the shim was changed by the second run"
[ "$(stat -c '%i %Y %a %s' "$home/.local/bin/gh")" = "$before" ] || fail "the shim was replaced by the second run"

# A gh the machine came with is used where it is, and not downloaded.
machine system-gh
mkdir -p "$home/system/bin"
printf '#!/bin/sh\necho "gh version 2.80.0 (the distribution)"\n' > "$home/system/bin/gh"
chmod 755 "$home/system/bin/gh"
run_tools "$home"
expect_ok
expect_shape
expect installed gh
[ "$(readlink "$home/.local/share/exeora/bin/gh")" = "$home/system/bin/gh" ] || fail "the real path is not a link to the machine's gh"
[ "$(line_of gh | awk '{ print $4 }')" = 2.80.0 ] || fail "the version is not the machine's: $(line_of gh)"
if grep -q '/gh_' "$home/calls/curl"; then fail "gh was downloaded although the machine has one"; fi
[ ! -e "$home/.local/bin/gh" ] || fail "something was written where the shim goes"
run_tools "$home"
expect_ok
all present

# An architecture the table does not know fails each build, and nothing else.
machine unknown-arch
echo riscv64 > "$home/arch"
run_tools "$home"
expect_blocked
expect_shape
# shellcheck disable=SC2086
expect failed $binary_tools
# shellcheck disable=SC2086
expect installed pnpm yarn $apt_tools
expect_clean "$home"
line_of jq | grep -q 'no build of jq for riscv64' || fail "no reason for an unknown architecture: $(line_of jq)"
printf '%s\n' "$out" | grep -q '^EXEORA_ENV .* arch=riscv64 ' || fail "the architecture is not reported: $out"
[ ! -e "$home/calls/curl" ] || fail "something was downloaded for an unknown architecture"
# With a gh of its own, such a machine is usable.
machine unknown-arch-with-gh
echo riscv64 > "$home/arch"
mkdir -p "$home/system/bin"
printf '#!/bin/sh\necho "gh version 2.80.0 (the distribution)"\n' > "$home/system/bin/gh"
chmod 755 "$home/system/bin/gh"
run_tools "$home"
expect_ok
expect installed gh
expect failed uv jq ripgrep yq git-lfs

# The other architecture the table knows gets its own builds.
machine arm
echo aarch64 > "$home/arch"
run_tools "$home"
expect_ok
expect_shape
all installed
if grep -v 'arm64\|aarch64' "$home/calls/curl"; then fail "a download of another architecture"; fi
"$home/.local/bin/rg" | grep -q 'aarch64' || fail "rg is not the build for aarch64"

# Without npm, what npm installs is skipped.
machine no-npm
run_tools "$home" "$bare_bin"
expect_ok
expect_shape
expect skipped pnpm yarn
# shellcheck disable=SC2086
expect installed $binary_tools $apt_tools

# One package apt cannot find does not take the others with it.
machine apt-unknown
echo tmux > "$home/apt-unknown"
run_tools "$home"
expect_ok
expect_shape
expect failed tmux
expect installed unzip zip make cc
line_of tmux | grep -q 'Unable to locate package tmux' || fail "no reason for a package apt cannot find: $(line_of tmux)"
[ "$(grep -c ' update$' "$home/calls/apt")" = 1 ] || fail "apt-get update ran more than once"
# An apt that reaches nothing fails those tools, and only those.
machine apt-broken
touch "$home/apt-broken"
run_tools "$home"
expect_ok
expect_shape
# shellcheck disable=SC2086
expect failed $apt_tools
# shellcheck disable=SC2086
expect installed $binary_tools pnpm yarn
[ "$(grep -c . "$home/calls/apt")" = 1 ] || fail "apt-get went on after its update failed: $(cat "$home/calls/apt")"

# A tool that is there and does not run is installed again.
machine broken-tool
mkdir -p "$home/.local/bin" "$home/.local/share/exeora/bin" "$home/.local/share/exeora/work.killed"
printf '#!/bin/sh\nexit 1\n' > "$home/.local/bin/jq"
printf '#!/bin/sh\nexit 1\n' > "$home/.local/share/exeora/bin/gh"
chmod 755 "$home/.local/bin/jq" "$home/.local/share/exeora/bin/gh"
touch "$home/.local/share/exeora/work.killed/half-a-download"
run_tools "$home"
expect_ok
all installed
expect_clean "$home"
"$home/.local/bin/jq" | grep -q "version $(field jq 6)" || fail "a jq that does not run was kept"

# Out of time, nothing new is started: what is missing fails for that reason,
# and what is there is still found.
machine late
run_tools "$home" "$fake_bin" "$late"
expect_blocked
expect_shape
all failed
expect_clean "$home"
line_of gh | grep -q 'no time was left' || fail "no reason for a tool there was no time for: $(line_of gh)"
[ ! -e "$home/calls/curl" ] && [ ! -e "$home/calls/apt" ] && [ ! -e "$home/calls/npm" ] || fail "something was started with no time left"
machine late-and-complete
run_tools "$home"
run_tools "$home" "$fake_bin" "$late"
expect_ok
all present

# A run that is stopped halfway leaves nothing of its work behind.
if setsid_bin="$(type -P setsid)"; then
  machine stopped
  touch "$home/slow"
  mkdir -p "$home/calls"
  { printf '(\n'; cat "$patched"; printf '\n'; cat "$root/wrap-tail.sh"; } > "$root/wrapped.sh"
  # shellcheck disable=SC2016
  env -i HOME="$home" PATH="$fake_bin:$base_bin" "$setsid_bin" "$base_bin/bash" -c 'exec bash -s < "$1"' - "$root/wrapped.sh" > "$root/stopped.out" 2>&1 &
  runner=$!
  waited=0
  until ls "$home/.local/share/exeora"/work.* >/dev/null 2>&1; do
    sleep 0.2
    waited=$((waited + 1))
    [ "$waited" -lt 50 ] || fail "the run never started: $(cat "$root/stopped.out")"
  done
  pkill -TERM -s "$runner" bash || fail "the run could not be stopped"
  wait "$runner" || true
  waited=0
  while pgrep -s "$runner" >/dev/null 2>&1; do
    sleep 0.2
    waited=$((waited + 1))
    [ "$waited" -lt 100 ] || fail "the run did not stop"
  done
  expect_clean "$home"
  if grep -q '^EXEORA_TOOLS_OK' "$root/stopped.out"; then fail "a run that was stopped ended well"; fi
else
  echo "test-cloud-tools: no setsid here, a stopped run was not tried" >&2
fi

echo "cloud tools: ok"
