#!/bin/bash
# Builds a standalone arm64 aria2c for macOS (Apple silicon only) from the official source tarball.
# Only Apple's own TLS/zlib/libc++ are linked, so the binary has no Homebrew dylib dependencies.
# Metalink, XML-RPC, SFTP, async DNS and the sqlite cookie store are disabled; TuberX only needs HTTP(S) segmented downloads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${ARIA2_VERSION:-1.37.0}"
WORK="${TMPDIR:-/tmp}/aria2-build"
OUT="$ROOT/resources/bin/darwin/aria2c"
rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"
curl -sL "https://github.com/aria2/aria2/releases/download/release-$VER/aria2-$VER.tar.xz" -o aria2.tar.xz
tar -xf aria2.tar.xz && cd "aria2-$VER"
COMMON="--with-appletls --without-openssl --without-gnutls --without-libnettle --without-libgmp --without-libgcrypt \
  --without-libxml2 --without-libexpat --without-sqlite3 --without-libssh2 --without-libcares --without-libuv \
  --disable-nls --disable-websocket --disable-metalink --disable-xml-rpc --disable-bittorrent"
build_arch() {
  local arch="$1"
  make distclean >/dev/null 2>&1 || true
  ./configure $COMMON --host="$arch-apple-darwin" --build="$(uname -m)-apple-darwin" \
    CFLAGS="-arch $arch -O2" CXXFLAGS="-arch $arch -O2" LDFLAGS="-arch $arch" >/dev/null
  make -j"$(sysctl -n hw.ncpu)" >/dev/null
  cp src/aria2c "$WORK/aria2c-$arch"
}
build_arch arm64
cp "$WORK/aria2c-arm64" "$OUT"
strip "$OUT" && chmod +x "$OUT" && codesign -s - -f "$OUT" >/dev/null 2>&1 || true
echo "built: $OUT"; file "$OUT"; "$OUT" --version | head -1; otool -L "$OUT"
