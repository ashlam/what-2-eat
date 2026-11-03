#!/usr/bin/env bash
# 无头 Chrome 截图：tools/shot.sh <url> <out.png> [宽] [高]
# 用 iframe 包裹，保证内部布局视口等于指定尺寸
set -u
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="$1"; OUT="$2"; W="${3:-390}"; H="${4:-844}"; BUDGET="${5:-3000}"
mkdir -p "$ROOT/.shots"
WRAP="$ROOT/.shots/_wrap.html"
STAMP="$(date +%s)$RANDOM"
HASH=""; case "$URL" in *#*) HASH="#${URL#*#}"; URL="${URL%%#*}";; esac
case "$URL" in *\?*) URL="$URL&_cb=$STAMP";; *) URL="$URL?_cb=$STAMP";; esac
URL="$URL$HASH"
cat > "$WRAP" <<HTML
<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}
iframe{width:${W}px;height:${H}px;border:0;display:block}</style></head>
<body><iframe src="${URL}"></iframe></body></html>
HTML
mkdir -p "$(dirname "$OUT")"
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
WIN_OUT="$(cygpath -m "$OUT_ABS")"
WIN_WRAP="$(cygpath -m "$WRAP")"
PROFILE="$(cygpath -m "$ROOT/.shots/_profile")"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size="${W},${H}" --force-prefers-reduced-motion \
  --virtual-time-budget="${BUDGET}" --screenshot="$WIN_OUT" "file:///$WIN_WRAP" >/dev/null 2>&1
[ -f "$OUT" ] && echo "ok $OUT ($(wc -c < "$OUT") bytes)" || { echo "失败 $OUT" >&2; exit 1; }
