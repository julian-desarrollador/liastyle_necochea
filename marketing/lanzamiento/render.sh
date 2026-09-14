#!/usr/bin/env bash
# Regenera los PNG de lanzamiento (1080x1920 stories / 1080x1080 WhatsApp).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/export"
CHROME="${CHROME:-/usr/bin/google-chrome-stable}"
mkdir -p "$OUT"

render() {
  local name="$1" w="$2" h="$3"
  echo "→ $name ${w}x${h}"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="${w},${h}" \
    --virtual-time-budget=12000 \
    --run-all-compositor-stages-before-draw \
    --screenshot="${OUT}/${name}.png" \
    "file://${ROOT}/${name}.html" >/dev/null 2>&1
}

render story-oscuro 1080 1920
render story-crema 1080 1920
render story-salon 1080 1920
render story-analia 1080 1920
render story-pasos 1080 1920
render wa-cuadrado 1080 1080
render wa-sage 1080 1080
render qr-mostrador 1080 1080
echo "Listo en $OUT"
