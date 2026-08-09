#!/usr/bin/env sh
set -eu

repository="leynier/exeora"
version="${EXEORA_VERSION:-latest}"
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
mkdir -p "$destination"
curl --fail --location --proto '=https' --tlsv1.2 "$release_url/$asset" --output "$temporary/exeora"
curl --fail --location --proto '=https' --tlsv1.2 "$release_url/checksums-sha256.txt" --output "$temporary/checksums"
expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "$temporary/checksums")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$temporary/exeora" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$temporary/exeora" | awk '{ print $1 }')"
fi
test -n "$expected" && test "$actual" = "$expected" || { echo "Exeora checksum verification failed." >&2; exit 1; }
chmod 755 "$temporary/exeora"
mv "$temporary/exeora" "$destination/exeora"
echo "Installed exeora in $destination. Add it to PATH if needed."
