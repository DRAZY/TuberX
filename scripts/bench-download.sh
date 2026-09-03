#!/bin/bash
# Throughput benchmark: same YouTube format (299 = 1080p60 h264, ~246 MB) through each downloader path.
# Usage: bash scripts/bench-download.sh [videoURL] [formatId]
URL="${1:-https://www.youtube.com/watch?v=aqz-KE-bpKQ}"; FMT="${2:-299}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; B="$ROOT/resources/bin/$(node -p process.platform)"
export PATH="$B:$PATH"
OUT="${TMPDIR:-/tmp}/tx-bench"; rm -rf "$OUT"; mkdir -p "$OUT"
COMMON=(--no-warnings --ignore-config --no-part --no-mtime --newline --js-runtimes "deno:$B/deno" --ffmpeg-location "$B" -f "$FMT")
run_mode() {
  local name="$1"; shift
  local start=$(date +%s.%N)
  "$B/yt-dlp" "${COMMON[@]}" "$@" -P "$OUT/$name" -o "%(id)s.%(ext)s" -- "$URL" > "$OUT/$name.log" 2>&1
  local rc=$?; local end=$(date +%s.%N)
  local secs=$(echo "$end - $start" | bc); local bytes=$(stat -f %z "$OUT/$name"/*.* 2>/dev/null | head -1)
  local mbps=$(echo "scale=1; ($bytes/1048576)/$secs" | bc 2>/dev/null)
  printf "%-22s rc=%s  %6.1fs  %sMB  %s MB/s  %s\n" "$name" "$rc" "$secs" "$(( ${bytes:-0} / 1048576 ))" "${mbps:-?}" "$(rg -o 'ERROR.*|WARNING.*' "$OUT/$name.log" | head -1 | cut -c1-90)"
}
run_mode native
run_mode native-N8          -N 8
run_mode aria2c-x8          --downloader aria2c --downloader-args "aria2c:-x 8 -s 8 -k 1M --file-allocation=none"
run_mode aria2c-x16         --downloader aria2c --downloader-args "aria2c:-x 16 -s 16 -k 1M --file-allocation=none"
PATH="/usr/bin:/bin" run_mode aria2c-nopath      --downloader aria2c --downloader-args "aria2c:-x 8 -s 8 -k 1M --file-allocation=none"
