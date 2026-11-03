#!/usr/bin/env bash
# 我家冰箱 · 本地预览（macOS / Linux / Git Bash）
set -u
cd "$(dirname "$0")"
PORT="${1:-5188}"
echo "============================================"
echo "  我家冰箱 · 本地预览"
echo "============================================"
echo "  http://127.0.0.1:${PORT}/index.html"
echo "  按 Ctrl+C 停止"
echo
( sleep 1; command -v open >/dev/null && open "http://127.0.0.1:${PORT}/index.html" ) &
python -m http.server "$PORT" --bind 127.0.0.1
