#!/usr/bin/env sh
set -eu

repository="leynier/exeora"
version="${EXEORA_VERSION:-latest}"
if [ "$version" != "latest" ]; then
  case "$version" in
    ''|*[!0-9A-Za-z.+-]*)
      echo "EXEORA_VERSION must contain only semver characters (for example 0.8.4 or 0.8.4-beta.1)." >&2
      exit 1
      ;;
  esac
fi
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) target="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64|Linux-arm64) target="aarch64-unknown-linux-gnu" ;;
  Darwin-x86_64) target="x86_64-apple-darwin" ;;
  Darwin-arm64) target="aarch64-apple-darwin" ;;
  *) echo "Unsupported platform: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

if [ "$version" = "latest" ]; then
  release_url="https://github.com/$repository/releases/latest/download"
else
  release_url="https://github.com/$repository/releases/download/cli-v$version"
fi
asset="exeora-$target"

destination="${EXEORA_INSTALL_DIR:-$HOME/.local/bin}"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT INT TERM
download() {
  curl --fail --location --proto '=https' --tlsv1.2 \
    --silent --show-error --connect-timeout 10 --max-time 120 --retry 3 --retry-delay 1 \
    "$1" --output "$2"
}

download "$release_url/$asset" "$temporary/exeora"
download "$release_url/checksums-sha256.txt" "$temporary/checksums"
expected="$(awk -v asset="$asset" '
  $2 == asset { count++; if (count == 1) hash = $1 }
  END {
    if (count == 1 && hash ~ /^[[:xdigit:]]+$/ && length(hash) == 64) print hash
  }
' "$temporary/checksums" | tr '[:upper:]' '[:lower:]')"
if [ -z "$expected" ]; then
  echo "Release checksums do not contain exactly one valid entry for $asset." >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$temporary/exeora" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$temporary/exeora" | awk '{ print $1 }')"
else
  echo "Exeora needs sha256sum or shasum to verify the release." >&2
  exit 1
fi
if [ "$actual" != "$expected" ]; then
  echo "Exeora checksum verification failed." >&2
  exit 1
fi
mkdir -p "$destination"
chmod 755 "$temporary/exeora"
mv "$temporary/exeora" "$destination/exeora"
echo "Installed exeora in $destination. Add it to PATH if needed."
