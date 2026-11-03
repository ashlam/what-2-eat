#!/usr/bin/env bash
# 从 icon/*.html 重新渲染启动图标（Chrome 无头截图，不依赖本地服务）
# 改了图标就重跑这个，再跑 build.sh
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
[ -x "$CHROME" ] || { echo "找不到 Chrome：$CHROME"; exit 1; }

shoot() {   # shoot <html> <out.png> <size>
  local src="$1" out="$2" size="$3"
  local url
  url="file:///$(cygpath -m "$PWD/$src")"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size="$size,$size" --force-device-scale-factor=1 \
    --default-background-color=00000000 --virtual-time-budget=2500 \
    --screenshot="$(cygpath -m "$PWD/$out")" "$url" >/dev/null 2>&1
  echo "  $out  ($(du -k "$out" | cut -f1) KB)"
}

echo "==> 旧版 launcher 图标（API 21~25 用，方形深绿底）"
shoot icon/app-icon.html    res/mipmap-xxxhdpi/ic_launcher.png    192

echo "==> 自适应图标前景层（API 26+ 用，透明底，圆形裁切不切边）"
shoot icon/app-icon-fg.html res/mipmap-xxxhdpi/ic_launcher_fg.png 432

echo "好了，接着跑 ./build.sh"
