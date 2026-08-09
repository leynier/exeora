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
