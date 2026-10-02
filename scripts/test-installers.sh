#!/usr/bin/env sh
set -eu

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT INT TERM
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"

cat > "$fake_bin/uname" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  -s) printf '%s\n' "$FAKE_UNAME_SYSTEM" ;;
  -m) printf '%s\n' "$FAKE_UNAME_MACHINE" ;;
esac
EOF

cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env sh
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [ "${url##*/}" = "checksums-sha256.txt" ]; then
  hash="$(printf native-exeora | sha256sum | awk '{ print $1 }')"
  printf '%s  %s\n' "$hash" "$EXPECTED_ASSET" > "$output"
  if [ "${DUPLICATE_CHECKSUM:-}" = "1" ]; then
    printf '%s  %s\n' "$hash" "$EXPECTED_ASSET" >> "$output"
  fi
else
  printf native-exeora > "$output"
fi
EOF
chmod +x "$fake_bin/uname" "$fake_bin/curl"

verify() {
  system="$1"
  machine="$2"
  target="$3"
  destination="$test_root/install-$target"
  FAKE_UNAME_SYSTEM="$system" \
    FAKE_UNAME_MACHINE="$machine" \
    EXPECTED_ASSET="exeora-$target" \
    EXEORA_INSTALL_DIR="$destination" \
    PATH="$fake_bin:$PATH" \
    sh ./install.sh >/dev/null
  test "$(cat "$destination/exeora")" = "native-exeora"
}

verify Linux x86_64 x86_64-unknown-linux-gnu
verify Linux aarch64 aarch64-unknown-linux-gnu
verify Darwin x86_64 x86_64-apple-darwin
verify Darwin arm64 aarch64-apple-darwin

invalid_destination="$test_root/invalid-version"
if EXEORA_VERSION='1.2.3/other-release' EXEORA_INSTALL_DIR="$invalid_destination" PATH="$fake_bin:$PATH" sh ./install.sh >/dev/null 2>&1; then
  echo "install.sh accepted a release path in EXEORA_VERSION" >&2
  exit 1
fi
test ! -e "$invalid_destination/exeora"

duplicate_destination="$test_root/duplicate-checksum"
if FAKE_UNAME_SYSTEM=Linux \
  FAKE_UNAME_MACHINE=x86_64 \
  EXPECTED_ASSET=exeora-x86_64-unknown-linux-gnu \
  DUPLICATE_CHECKSUM=1 \
  EXEORA_INSTALL_DIR="$duplicate_destination" \
  PATH="$fake_bin:$PATH" sh ./install.sh >/dev/null 2>&1; then
  echo "install.sh accepted duplicate release checksums" >&2
  exit 1
fi
test ! -e "$duplicate_destination/exeora"
