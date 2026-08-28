#!/usr/bin/env sh
# Fail if a Linux binary needs a newer glibc than the published floor.
# Ubuntu 20.04 LTS ships 2.31; anything above that will not run there.
set -eu

binary="${1:-}"
maximum="${2:-2.31}"

if [ -z "$binary" ] || [ ! -f "$binary" ]; then
  echo "Usage: $0 <binary> [maximum-glibc]" >&2
  exit 1
fi

if ! version_info="$(LC_ALL=C readelf -W --version-info "$binary")"; then
  echo "Could not read ELF version requirements from $binary." >&2
  exit 1
fi

requirements="$(
  printf '%s\n' "$version_info" |
    sed -n 's/.*Name: GLIBC_\([^ ]*\).*/\1/p'
)"

if [ -z "$requirements" ]; then
  echo "$binary has no GLIBC version requirements; expected a dynamically linked GNU binary." >&2
  exit 1
fi

if printf '%s\n' "$requirements" | grep -qv '^[0-9][0-9.]*$'; then
  echo "$binary has unsupported named GLIBC ABI requirements:" >&2
  printf '%s\n' "$requirements" | grep -v '^[0-9][0-9.]*$' >&2
  exit 1
fi

highest="$(printf '%s\n' "$requirements" | sort -V | tail -n 1)"

echo "$binary requires GLIBC $highest (maximum $maximum)."

if [ "$(printf '%s\n%s\n' "$maximum" "$highest" | sort -V | tail -n 1)" != "$maximum" ]; then
  echo "$binary requires GLIBC $highest, which is newer than $maximum." >&2
  echo "Linux releases must run on Ubuntu 20.04 LTS (glibc 2.31)." >&2
  exit 1
fi
