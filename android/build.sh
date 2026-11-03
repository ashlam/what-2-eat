#!/usr/bin/env bash
# 打一个免 Gradle 的 APK：aapt2 出资源包 → javac + d8 出 dex → zip 进去 → zipalign → apksigner
# 依赖：Android SDK build-tools 34 + platforms/android-34 + 一个 JDK
#   · javac / keytool 只要是 JDK 8+ 即可（这台机器上是 JDK 8）
#   · d8 / apksigner 是 class 55 的，必须跑在 Java 11+ 上
#     所以脚本会优先用 android/.jre17 里的 JRE（build.sh 首次运行前用 setup 补一下，见 README）
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
JDK="${JAVA_HOME:-/c/Program Files/Java/jdk1.8.0_201}"

[ -x "$JDK/bin/javac.exe" ] || { echo "找不到 JDK：$JDK"; exit 1; }
[ -f "$BT/aapt2.exe" ] || { echo "找不到 build-tools：$BT"; exit 1; }
[ -f "$PLATFORM" ] || { echo "找不到 android.jar：$PLATFORM"; exit 1; }

JAVAC="$JDK/bin/javac.exe"
KEYTOOL="$JDK/bin/keytool.exe"

# 跑 jar 用的 JVM：优先项目内那套 JRE 17
RUNJAVA=""
for cand in .jre17/*/bin/java.exe "$JDK/bin/java.exe"; do
  [ -x "$cand" ] || continue
  ver=$("$cand" -version 2>&1 | head -1 | sed -n 's/.*version "\([0-9]*\).*/\1/p')
  if [ "${ver:-0}" -ge 11 ]; then RUNJAVA="$cand"; break; fi
done
[ -n "$RUNJAVA" ] || {
  echo "d8 / apksigner 需要 Java 11+，但没找到可用的 JVM。"
  echo "把任意 JRE 11+ 解压到 android/.jre17/ 下即可（脚本会自动发现）。"
  exit 1
}

AAPT2="$BT/aapt2.exe"
ZIPALIGN="$BT/zipalign.exe"
APKSIGNER_JAR="$BT/lib/apksigner.jar"
D8_JAR="$BT/lib/d8.jar"

W() { cygpath -w "$1"; }   # 给 Windows 原生 exe / JDK 用的路径

VER_CODE=1
VER_NAME=0.9
OUT="build"
APK_NAME="what2eat-$VER_NAME.apk"
KS="keystore/what2eat.jks"
KS_PASS="what2eat"
KS_ALIAS="what2eat"

echo "==> 0/6 同步网页资源到 assets/www"
rm -rf assets/www
mkdir -p assets/www
cp ../index.html assets/www/index.html
cp -r ../assets assets/www/assets
# 附带离线说明，方便以后翻包的人知道这壳是干嘛的
cat > assets/www/_readme.txt <<'TXT'
这个目录由 android/build.sh 从仓库根目录的 index.html + assets/ 同步而来。
不要直接改这里，改完根目录再跑一次 build.sh。
TXT

echo "==> 1/6 编译资源"
rm -rf "$OUT"
mkdir -p "$OUT/compiled" "$OUT/classes" "$OUT/dex" "$OUT/apk"
"$AAPT2" compile --dir res -o "$OUT/compiled/res.zip"

echo "==> 2/6 链接资源 + 打包 assets"
"$AAPT2" link \
  -o "$OUT/apk/base.apk" \
  -I "$(W "$PLATFORM")" \
  --manifest AndroidManifest.xml \
  -A assets \
  --min-sdk-version 21 \
  --target-sdk-version 34 \
  --version-code "$VER_CODE" \
  --version-name "$VER_NAME" \
  "$OUT/compiled/res.zip"

echo "==> 3/6 编译 Java"
"$JAVAC" -source 1.8 -target 1.8 -nowarn -encoding UTF-8 \
  -bootclasspath "$(W "$PLATFORM")" \
  -d "$OUT/classes" \
  java/com/what2eat/app/MainActivity.java

echo "==> 4/6 转成 dex"
"$RUNJAVA" -cp "$(W "$D8_JAR")" com.android.tools.r8.D8 \
  --release --min-api 21 --lib "$(W "$PLATFORM")" \
  --output "$OUT/dex" \
  "$OUT"/classes/com/what2eat/app/*.class

cp "$OUT/dex/classes.dex" "$OUT/apk/classes.dex"

echo "==> 5/6 塞进 APK 并 zipalign"
python3 - "$OUT/apk/base.apk" "$OUT/apk/classes.dex" <<'PY'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
print('   classes.dex ->', apk)
PY
"$ZIPALIGN" -f -p 4 "$OUT/apk/base.apk" "$OUT/apk/aligned.apk"

echo "==> 6/6 签名"
mkdir -p keystore
if [ ! -f "$KS" ]; then
  echo "   生成签名密钥（首次）"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$(W "$KS")" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=What2Eat, OU=Home, O=Home, L=Home, ST=Home, C=CN" >/dev/null 2>&1
fi
"$RUNJAVA" -jar "$(W "$APKSIGNER_JAR")" sign \
  --ks "$(W "$KS")" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias "$KS_ALIAS" \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$OUT/$APK_NAME" "$OUT/apk/aligned.apk"

"$RUNJAVA" -jar "$(W "$APKSIGNER_JAR")" verify --print-certs "$OUT/$APK_NAME" | head -4

echo
echo "✅ 出了：android/$OUT/$APK_NAME  ($(du -k "$OUT/$APK_NAME" | cut -f1) KB)"
