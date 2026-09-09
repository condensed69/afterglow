#!/bin/sh
# tools/screenshot.sh — headless-Chrome captures for UI_OVERHAUL_PLAN.md PR bodies.
# Serves the repo over 127.0.0.1:8765, captures a fresh save at the four
# acceptance viewports, and writes to .github/pr/shots/ (linked from the PR body).
# Usage: tools/screenshot.sh [outdir]
# Requires: google-chrome (headless=new), python3 (static server).
set -eu
OUTDIR="${1:-.github/pr/shots}"
PORT=8765
mkdir -p "$OUTDIR"
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
sleep 1
shot() {
  W="$1"; H="$2"; NAME="$3"
  google-chrome --headless=new --hide-scrollbars=false \
    --window-size="$W,$H" --virtual-time-budget=6000 \
    --screenshot="$OUTDIR/$NAME.png" "http://127.0.0.1:$PORT/" >/dev/null 2>&1
  echo "wrote $OUTDIR/$NAME.png"
}
shot 1366 768  desktop-1366x768
shot 1920 1080 desktop-1920x1080
shot 2560 1440 desktop-2560x1440
shot 390 844   mobile-390x844
