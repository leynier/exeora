# Exeora Cloud toolset.
#
# Runs inside a machine as the `sprite` user, fed to `bash -s` by the gateway
# with no arguments and no environment of its own. Gives the machine the tools
# an agent expects to find, and says what it found and what it did, one line
# per tool, in a form the gateway reads. Every tool is attempted every time,
# and only one marked as blocking can fail the run. Each is looked for before
# anything is fetched, so a second run on a complete machine changes nothing.
#
# What is not known about a machine until one is looked at (its architecture,
# whether sudo answers, what it came with) is found out here. It decides which
# rows of the table apply, never what is done with a row.
set -euo pipefail
set +x
# Not the bootstrap's 077: what apt installs through sudo inherits this, and
# nothing written here is secret.
umask 022

# The table.
#   path   the PATH the service runs with, {home} being $HOME. A tool is
#          present when it is found there and runs.
#   tool   name, command, whether the machine is unusable without it, the
#          installer, the pinned version, the package (npm and apt), the
#          argument that makes it print its version, and where it goes when
#          that is not the first directory of the path.
#   build  for the `binary` installer, one per tool and architecture: the
#          sha256 of the download, its format (tar.gz or raw), the files
#          taken out of it (the first is the tool), and its address.
#          {version} is the tool's. A tool with no row for this machine's
#          architecture fails with that as the reason.
# `gh` has a place of its own because $HOME/.local/bin/gh is a shim written
# by another part of the system, which signs gh in and then runs this one.
table() {
  cat <<'__EXEORA_TOOLS__'
path  {home}/.local/bin:/.sprite/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
tool  gh       gh       yes  binary  2.101.0  -                --version  {home}/.local/share/exeora/bin/gh
tool  uv       uv       no   binary  0.12.19  -                --version  -
tool  jq       jq       no   binary  1.8.2    -                --version  -
tool  ripgrep  rg       no   binary  15.2.0   -                --version  -
tool  yq       yq       no   binary  4.53.6   -                --version  -
tool  git-lfs  git-lfs  no   binary  3.8.0    -                --version  -
tool  pnpm     pnpm     no   npm     12.6.0   pnpm             --version  -
tool  yarn     yarn     no   npm     1.22.22  yarn             --version  -
tool  unzip    unzip    no   apt     -        unzip            -v         -
tool  zip      zip      no   apt     -        zip              -v         -
tool  make     make     no   apt     -        make             --version  -
tool  cc       cc       no   apt     -        build-essential  --version  -
tool  tmux     tmux     no   apt     -        tmux             -V         -
build gh       x86_64   9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8  tar.gz  gh_{version}_linux_amd64/bin/gh  https://github.com/cli/cli/releases/download/v{version}/gh_{version}_linux_amd64.tar.gz
build gh       aarch64  b57e8063f18862647c9d22727c32e9da1b963f8bf9db648fe123a6975695640f  tar.gz  gh_{version}_linux_arm64/bin/gh  https://github.com/cli/cli/releases/download/v{version}/gh_{version}_linux_arm64.tar.gz
build uv       x86_64   23bf5552d220e0842b65c862097b2ebaeba0064b74eda5e565e77fd25969d8c8  tar.gz  uv-x86_64-unknown-linux-gnu/uv,uv-x86_64-unknown-linux-gnu/uvx  https://github.com/astral-sh/uv/releases/download/{version}/uv-x86_64-unknown-linux-gnu.tar.gz
build uv       aarch64  0804e9b164c64b6914182d5920c08551958a095986f10a3731056df701126436  tar.gz  uv-aarch64-unknown-linux-gnu/uv,uv-aarch64-unknown-linux-gnu/uvx  https://github.com/astral-sh/uv/releases/download/{version}/uv-aarch64-unknown-linux-gnu.tar.gz
build jq       x86_64   b1c22172dd303f3be49e935aa56aa48a8b7a46e0bc838b4997d3bb451495870f  raw     jq  https://github.com/jqlang/jq/releases/download/jq-{version}/jq-linux-amd64
build jq       aarch64  8b85c817833814ddca00a144c33705546355afccf0cf39b188f3cdb48b852309  raw     jq  https://github.com/jqlang/jq/releases/download/jq-{version}/jq-linux-arm64
build ripgrep  x86_64   33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c  tar.gz  ripgrep-{version}-x86_64-unknown-linux-musl/rg  https://github.com/BurntSushi/ripgrep/releases/download/{version}/ripgrep-{version}-x86_64-unknown-linux-musl.tar.gz
build ripgrep  aarch64  800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915  tar.gz  ripgrep-{version}-aarch64-unknown-linux-musl/rg  https://github.com/BurntSushi/ripgrep/releases/download/{version}/ripgrep-{version}-aarch64-unknown-linux-musl.tar.gz
build yq       x86_64   c5f056448f973ae7d39b5401949648a78f2dc1947d6a8eb65be60d5c504b9385  raw     yq  https://github.com/mikefarah/yq/releases/download/v{version}/yq_linux_amd64
build yq       aarch64  88a1016bc1d657375a35864e4f44b6f333df8ff97b559f51bba0adcb2169df09  raw     yq  https://github.com/mikefarah/yq/releases/download/v{version}/yq_linux_arm64
build git-lfs  x86_64   e455e00f15d9b95661b8d53498ffb0c3367962cf1ec73c31ab7369516cd6ab8d  tar.gz  git-lfs-{version}/git-lfs  https://github.com/git-lfs/git-lfs/releases/download/v{version}/git-lfs-linux-amd64-v{version}.tar.gz
build git-lfs  aarch64  ac9c8efac980bb0505ead384d087e2acb6486fd8498691a2165fa174ec6118c2  tar.gz  git-lfs-{version}/git-lfs  https://github.com/git-lfs/git-lfs/releases/download/v{version}/git-lfs-linux-arm64-v{version}.tar.gz
__EXEORA_TOOLS__
}

# Seconds the run may spend before it stops starting anything new, and the
# most one download, one npm install and the apt work may each take of them.
BUDGET=270
STARTED="$SECONDS"
DOWNLOAD_SECONDS=60
NPM_SECONDS=90
APT_SECONDS=200

LOCAL_BIN="$HOME/.local/bin"
STATE="$HOME/.local/share/exeora"
WORK=""
WHY=""
SKIPPED=""
BLOCKED=""
# Nothing asks a question, and a tool that is only asked its version leaves
# no cache in /tmp and no device id in the home directory for it. This is
# the environment of this run alone, not of what uses the tools later.
export DEBIAN_FRONTEND=noninteractive
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export DISABLE_V8_COMPILE_CACHE=1
export GH_TELEMETRY=false
export DO_NOT_TRACK=1

log() { printf 'tools: %s\n' "$*"; }
oneline() { printf '%s' "$*" | tr '\r\n\t' '   ' | cut -c 1-400; }
report() { # name state version blocks reason
  printf 'EXEORA_TOOL %s %s %s %s %s\n' "$1" "$2" "${3:--}" "$4" "$(oneline "${5:--}")"
}

cleanup() { if [ -n "$WORK" ]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Runs a command for at most so many seconds, when the machine can count them.
limited() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then timeout -k 5 "$seconds" "$@"; else "$@"; fi
}

# The seconds a step may take: what it asks for, or what is left of the
# budget when that is less. Fails when nothing is left.
time_for() {
  local left=$((BUDGET - (SECONDS - STARTED)))
  if [ "$left" -lt 5 ]; then return 1; fi
  if [ "$left" -gt "$1" ]; then left="$1"; fi
  printf '%s' "$left"
}

last_line() { # file, what to say when it is empty
  local line=""
  if [ -s "$1" ]; then line="$(grep -v '^[[:space:]]*$' "$1" 2>/dev/null | tail -n 1 || true)"; fi
  printf '%s' "${line:-$2}"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d ' ' -f 1
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 -r "$1" | cut -d ' ' -f 1
  else return 1; fi
}

# What a program says its version is, run the way the service would run it.
# Fails when it does not run. Nothing here reads the script bash is reading.
version_of() { # path, argument
  local out
  out="$(limited 15 env PATH="$SERVICE_PATH" "$1" "$2" </dev/null 2>&1)" || return 1
  if [[ "$out" =~ [0-9]+(\.[0-9]+)+[a-z]? ]]; then printf '%s' "${BASH_REMATCH[0]}"; else printf '%s' -; fi
}

# Whether a tool is here and runs. Prints its version.
have() { # command, argument, place of its own or -
  local path
  if [ "$3" != - ]; then
    path="$3"
    if [ ! -x "$path" ]; then return 1; fi
  else
    path="$(PATH="$SERVICE_PATH" command -v "$1" 2>/dev/null)" || return 1
  fi
  version_of "$path" "$2"
}

# A copy the machine came with, for a tool that has a place of its own:
# anywhere on the path but the first directory, where the shim is, and never
# something that is the shim or the place itself under another name.
elsewhere() { # command, argument, place
  local dir candidate real
  local -a dirs=()
  IFS=: read -r -a dirs <<<"$SERVICE_PATH:$PATH"
  for dir in "${dirs[@]}"; do
    dir="${dir%/}"
    candidate="$dir/$1"
    if [ -z "$dir" ] || [ "$dir" = "$LOCAL_BIN" ] || [ ! -f "$candidate" ] || [ ! -x "$candidate" ]; then continue; fi
    real="$(readlink -f "$candidate" 2>/dev/null || true)"
    if [ -z "$real" ] || [ "$real" = "$LOCAL_BIN/$1" ] || [ "$real" = "$3" ]; then continue; fi
    if version_of "$candidate" "$2" >/dev/null; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

# Into place in one rename. The shim is never written, whatever a row says.
place() { # file, destination
  if [ "$2" = "$LOCAL_BIN/gh" ]; then
    WHY="$2 is the shim, and is never written here"
    return 1
  fi
  if ! mkdir -p "$(dirname "$2")" || ! mv -f "$1" "$2"; then
    WHY="could not write $2"
    return 1
  fi
}

build_for() { # name: sets B_SHA B_FORMAT B_FILES B_URL from the row of this architecture
  local row kind name arch
  for row in "${ROWS[@]}"; do
    read -r kind name arch B_SHA B_FORMAT B_FILES B_URL <<<"$row"
    if [ "$kind" = build ] && [ "$name" = "$1" ] && [ "$arch" = "$ARCH" ]; then return 0; fi
  done
  return 1
}

install_binary() { # name, version, argument, destination
  local name="$1" version="$2" dest="$4" seconds url archive got rc=0 index
  local -a files=()
  if ! build_for "$name"; then
    WHY="there is no build of $name for $ARCH"
    return 1
  fi
  if ! seconds="$(time_for "$DOWNLOAD_SECONDS")"; then
    WHY="no time was left to download it"
    return 1
  fi
  url="${B_URL//\{version\}/$version}"
  IFS=, read -r -a files <<<"${B_FILES//\{version\}/$version}"
  archive="$WORK/$name.download"
  rm -rf "$archive" "$WORK/$name.d"
  mkdir -p "$WORK/$name.d"
  log "installing $name $version"
  limited "$((seconds + 10))" curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 15 \
    --max-time "$seconds" --retry 2 --retry-delay 2 --retry-max-time "$seconds" \
    -o "$archive" "$url" </dev/null 2>"$WORK/err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    WHY="the download failed: $(last_line "$WORK/err" "curl exit $rc")"
    return 1
  fi
  # Checked before anything is unpacked, let alone installed.
  if ! got="$(sha256_of "$archive")"; then
    WHY="this machine has nothing to compute a sha256 with"
    return 1
  fi
  if [ "$got" != "$B_SHA" ]; then
    WHY="the checksum of the download did not match: expected $B_SHA, got $got"
    return 1
  fi
  case "$B_FORMAT" in
    tar.gz)
      if ! tar -xzf "$archive" -C "$WORK/$name.d" --no-same-owner "${files[@]}" </dev/null 2>"$WORK/err"; then
        WHY="the download could not be unpacked: $(last_line "$WORK/err" "tar failed")"
        return 1
      fi
      ;;
    raw) mv -f "$archive" "$WORK/$name.d/${files[0]}" ;;
    *)
      WHY="the table names a format that is not known: $B_FORMAT"
      return 1
      ;;
  esac
  for index in "${!files[@]}"; do chmod 755 "$WORK/$name.d/${files[$index]}" || true; done
  if ! version_of "$WORK/$name.d/${files[0]}" "$3" >/dev/null; then
    WHY="the build for $ARCH does not run on this machine"
    return 1
  fi
  for index in "${!files[@]}"; do
    if [ "$index" -eq 0 ]; then place "$WORK/$name.d/${files[0]}" "$dest" || return 1
    else place "$WORK/$name.d/${files[$index]}" "$(dirname "$dest")/$(basename "${files[$index]}")" || return 1; fi
  done
}

install_npm() { # name, version, package
  local seconds
  if ! command -v npm >/dev/null 2>&1; then
    SKIPPED=1
    WHY="npm is not on this machine"
    return 1
  fi
  if ! seconds="$(time_for "$NPM_SECONDS")"; then
    WHY="no time was left to install it"
    return 1
  fi
  log "installing $1 $2"
  # npm's cache and logs go with the work directory.
  if ! limited "$seconds" npm install -g --prefix "$HOME/.local" --cache "$WORK/npm" --no-fund \
    --no-audit --no-update-notifier --loglevel=error "$3@$2" </dev/null >"$WORK/err" 2>&1; then
    WHY="npm install failed: $(last_line "$WORK/err" "no output")"
    return 1
  fi
}

# One tool that is not apt's: looked for, installed when missing, reported.
settle() { # name command blocks installer version package argument place
  local name="$1" blocks="$3" installer="$4" own="$8" dest found version state=failed
  if [ "$own" != - ]; then dest="$own"; else dest="$LOCAL_BIN/$2"; fi
  if version="$(have "$2" "$7" "$own")"; then
    report "$name" present "$version" "$blocks" -
    return 0
  fi
  WHY=""
  SKIPPED=""
  if [ "$own" != - ] && found="$(elsewhere "$2" "$7" "$own")"; then
    log "$name: using the one at $found"
    rm -f "$WORK/$name.link"
    WHY="could not link to $found"
    if ln -s "$found" "$WORK/$name.link" && place "$WORK/$name.link" "$dest"; then
      state=installed
      WHY="linked to $found"
    fi
  else
    case "$installer" in
      binary) if install_binary "$name" "$5" "$7" "$dest"; then state=installed; fi ;;
      npm) if install_npm "$name" "$5" "$6"; then state=installed; fi ;;
      *) WHY="the table names an installer that is not known: $installer" ;;
    esac
  fi
  if [ "$state" = installed ]; then
    if version="$(have "$2" "$7" "$own")"; then
      report "$name" installed "$version" "$blocks" "${WHY:--}"
      return 0
    fi
    WHY="it was installed, and does not run with the service's PATH"
  fi
  if [ -n "$SKIPPED" ]; then state=skipped; else state=failed; fi
  log "$name: $state: $WHY"
  report "$name" "$state" - "$blocks" "$WHY"
  if [ "$blocks" = yes ] && [ -z "$BLOCKED" ]; then BLOCKED="$name $(oneline "$WHY")"; fi
}

apt_run() { # apt-get's arguments
  local seconds
  if ! seconds="$(time_for "$APT_SECONDS")"; then
    printf 'no time was left\n' >"$WORK/err"
    return 1
  fi
  limited "$seconds" "${ROOT[@]}" env DEBIAN_FRONTEND=noninteractive apt-get -q -y \
    -o DPkg::Lock::Timeout=60 -o Acquire::Retries=2 -o Dpkg::Options::=--force-confold \
    "$@" </dev/null >"$WORK/err" 2>&1
}

# Every apt tool in one go: one update and one install, and only when some
# are missing and root answers without asking for a password.
settle_apt() {
  local row kind name command blocks installer package check version state why=""
  local -a rows=() missing=()
  for row in "${ROWS[@]}"; do
    read -r kind name command blocks installer _ package check _ <<<"$row"
    if [ "$kind" != tool ] || [ "$installer" != apt ]; then continue; fi
    rows+=("$row")
    if ! have "$command" "$check" - >/dev/null; then missing+=("$package"); fi
  done
  state=failed
  if [ "${#missing[@]}" -eq 0 ]; then :
  elif [ "$SUDO" != yes ]; then
    state=skipped
    why="sudo does not answer without a password on this machine"
  elif [ "$APT" != yes ]; then
    state=skipped
    why="apt-get is not on this machine"
  else
    log "installing ${missing[*]}"
    if ! apt_run update; then
      why="apt-get update failed: $(last_line "$WORK/err" "no output")"
    elif ! apt_run install --no-install-recommends "${missing[@]}"; then
      why="apt-get install failed: $(last_line "$WORK/err" "no output")"
      log "$why"
      # One package apt cannot find fails the whole batch, so each is then
      # tried by itself and the rest are not lost with it.
      if [ "${#missing[@]}" -gt 1 ]; then
        for package in "${missing[@]}"; do apt_run install --no-install-recommends "$package" || true; done
      fi
    else
      why="apt-get installed it, and it does not run with the service's PATH"
    fi
  fi
  for row in "${rows[@]}"; do
    read -r kind name command blocks installer _ package check _ <<<"$row"
    if version="$(have "$command" "$check" -)"; then
      case " ${missing[*]-} " in
        *" $package "*) report "$name" installed "$version" "$blocks" - ;;
        *) report "$name" present "$version" "$blocks" - ;;
      esac
      continue
    fi
    log "$name: $state: $why"
    report "$name" "$state" - "$blocks" "$why"
    if [ "$blocks" = yes ] && [ -z "$BLOCKED" ]; then BLOCKED="$name $(oneline "$why")"; fi
  done
}

ROWS=()
while IFS= read -r row; do ROWS+=("$row"); done < <(table)
SERVICE_PATH="$PATH"
for row in "${ROWS[@]}"; do
  read -r kind value _ <<<"$row"
  if [ "$kind" = path ]; then SERVICE_PATH="${value//\{home\}/$HOME}"; fi
done

ARCH="$(uname -m 2>/dev/null || true)"
ARCH="${ARCH:-unknown}"
OS=-
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  OS="$(. /etc/os-release 2>/dev/null; printf '%s-%s' "${ID:-unknown}" "${VERSION_ID:-unknown}")" || OS=-
  OS="${OS//[^A-Za-z0-9._-]/_}"
fi
SUDO=no
ROOT=(sudo -n)
if [ "$(id -u 2>/dev/null || true)" = 0 ]; then
  SUDO=yes
  ROOT=(env)
elif command -v sudo >/dev/null 2>&1 && limited 15 sudo -n true </dev/null >/dev/null 2>&1; then
  SUDO=yes
fi
APT=no
if command -v apt-get >/dev/null 2>&1; then APT=yes; fi
SHM=no
if [ -r /proc/mounts ]; then
  while read -r _ mount type _; do
    if [ "$mount" != /dev/shm ]; then continue; fi
    case "$type" in tmpfs | ramfs) SHM=yes ;; *) SHM=no ;; esac
  done </proc/mounts
fi

# The work directory sits beside where the tools go, so moving one into place
# is a rename. What a run that was killed outright left behind goes first.
if ! mkdir -p "$STATE/bin" "$LOCAL_BIN" || ! rm -rf "$STATE"/work.* \
  || ! WORK="$(mktemp -d "$STATE/work.XXXXXX")"; then
  WORK=""
  log "error: cannot write under $HOME/.local"
  echo "EXEORA_TOOLS_FAILED gh the machine's home directory cannot be written to"
  exit 1
fi

for row in "${ROWS[@]}"; do
  read -r kind name command blocks installer version package check place <<<"$row"
  if [ "$kind" != tool ] || [ "$installer" = apt ]; then continue; fi
  settle "$name" "$command" "$blocks" "$installer" "$version" "$package" "$check" "${place//\{home\}/$HOME}"
done
settle_apt

# Git is told of the filter git-lfs is. Without it a repository that keeps
# files in LFS is checked out as the pointers to them, and stays so. Told to
# git as a whole and to no repository, since none is cloned yet. Not having
# it is no reason to stop, so a failure is a line here and nothing more.
if PATH="$SERVICE_PATH" command -v git-lfs >/dev/null 2>&1; then
  PATH="$SERVICE_PATH:$PATH" limited 30 git lfs install --skip-repo </dev/null >/dev/null 2>&1 \
    || log "warning: git could not be told of git-lfs"
fi

printf 'EXEORA_ENV os=%s arch=%s sudo=%s apt=%s shm=%s\n' "$OS" "$ARCH" "$SUDO" "$APT" "$SHM"
if [ -n "$BLOCKED" ]; then
  echo "EXEORA_TOOLS_FAILED $BLOCKED"
  exit 1
fi
log "done in $((SECONDS - STARTED))s"
echo EXEORA_TOOLS_OK
