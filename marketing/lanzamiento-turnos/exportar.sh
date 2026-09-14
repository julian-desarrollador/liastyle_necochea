#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/png"
mkdir -p "$OUT"
CHROME="${CHROME:-google-chrome}"

shot() {
  local html="$1"
  local name="$2"
  local w="$3"
  local h="$4"
  local dir="/tmp/chrome-flyers-$name"
  rm -rf "$dir"
  mkdir -p "$dir"
  timeout 18s "$CHROME" \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --hide-scrollbars \
    --allow-file-access-from-files \
    --user-data-dir="$dir" \
    --window-size="${w},${h}" \
    --force-device-scale-factor=1 \
    --virtual-time-budget=2500 \
    --screenshot="$OUT/${name}.png" \
    "file://${ROOT}/${html}" \
    >/tmp/chrome-"$name".log 2>&1 || true
  echo "wrote $OUT/${name}.png ($(wc -c < "$OUT/${name}.png") bytes)"
}

shot historia-crema.html historia-crema 1080 1920
shot historia-app.html historia-app 1080 1920
shot historia-foto.html historia-foto 1080 1920
shot whatsapp-cuadrado.html whatsapp-cuadrado 1080 1080
ls -la "$OUT"
