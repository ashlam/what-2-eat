#!/usr/bin/env bash
# 打一个免 Gradle 的 APK：aapt2 出资源包 → javac + d8 出 dex → 塞进 APK → zipalign → apksigner
#
# 用法：./build.sh    或    bash build.sh    或（Linux 上）sh build.sh
#   —— 脚本刻意写成 POSIX shell 兼容的：Debian/Ubuntu 的 sh 是 dash，
#      bash 专有的 pipefail / <(...) 在那儿会直接语法错误。
#
# 依赖（Windows / Linux / macOS 通用）：
#   · Android SDK：build-tools（要有 aapt2、zipalign、lib/d8.jar、lib/apksigner.jar）+ platform android-34
#     用 ANDROID_HOME / ANDROID_SDK_ROOT 指过去，或者放在各平台的默认位置
#   · JDK 11+：javac 编 Java、keytool 生成密钥、java 跑 d8 和 apksigner
#     只有 JDK 8 的老机器也能用：把任意 JRE 11+ 解压到 android/.jre17/ 下，脚本会自动挑
set -eu
# pipefail 不是 POSIX 的，能开就开
(set -o pipefail) 2>/dev/null && set -o pipefail || true

cd "$(dirname "$0")"

# ---------------- 平台探测 ----------------
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN* | Windows_NT) EXE=".exe"; WIN=1 ;;
  *) EXE=""; WIN=0 ;;
esac
# 给 Windows 原生 exe 用的路径（Git Bash 里是 /c/...，得转成 C:\...）；Linux/macOS 原样
W() { if [ "$WIN" = 1 ] && command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
die() { printf '\xe2\x9c\x97 %s\n' "$*" >&2; exit 1; }

# ---------------- Android SDK ----------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ]; then
  for c in "${LOCALAPPDATA:-}/Android/Sdk" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" "$HOME/android-sdk"; do
    [ -d "$c" ] && { SDK="$c"; break; }
  done
fi
[ -n "$SDK" ] && [ -d "$SDK" ] || die "找不到 Android SDK。先 export ANDROID_HOME=/path/to/android-sdk"

# build-tools：优先 34.0.0（一直用它，别无缘无故换），没有就用版本号最大的
BT=""
if [ -x "$SDK/build-tools/${BT_VERSION:-34.0.0}/aapt2$EXE" ]; then
  BT="$SDK/build-tools/${BT_VERSION:-34.0.0}"
else
  for v in $(ls -1 "$SDK/build-tools" 2>/dev/null | sort -rV); do
    if [ -x "$SDK/build-tools/$v/aapt2$EXE" ]; then BT="$SDK/build-tools/$v"; break; fi
  done
fi
[ -n "$BT" ] || die "在 $SDK/build-tools 下没找到 aapt2。装一个：sdkmanager \"build-tools;34.0.0\""

# platform：优先 android-34，没有就用最新的
PLATFORM=""
if [ -f "$SDK/platforms/android-34/android.jar" ]; then
  PLATFORM="$SDK/platforms/android-34/android.jar"
else
  for v in $(ls -1 "$SDK/platforms" 2>/dev/null | sort -rV); do
    if [ -f "$SDK/platforms/$v/android.jar" ]; then PLATFORM="$SDK/platforms/$v/android.jar"; break; fi
  done
fi
[ -n "$PLATFORM" ] || die "没找到 android.jar。装一个：sdkmanager \"platforms;android-34\""

# ---------------- JDK ----------------
# 主版本号：javac 1.8.0_201 → 8；javac 17.0.20 → 17
# 注意 java -version 第一行末尾还带发布日期（... "17.0.20.1" 2026-01-20），
# 所以优先抓引号里的版本号，抓不到（javac 就没有引号）再退回「最后一个像版本号的词」
major_of() {
  _v="$("$1" -version 2>&1 | head -1 | sed -n 's/.*version "\([^"]*\)".*/\1/p')"
  [ -n "$_v" ] || _v="$("$1" -version 2>&1 | head -1 | sed -n 's/.* \([0-9][0-9._]*\).*/\1/p')"
  case "$_v" in
    1.*) _m="$(printf '%s' "$_v" | cut -d. -f2)" ;;
    *) _m="${_v%%.*}" ;;
  esac
  printf '%s' "${_m:-0}"
}

# JDK 可能装在任何地方：先看 JAVA_HOME / PATH，再扫各平台常见目录，取版本最高的那个
# （Windows 上常见 java 在 PATH 而 javac 不在，只靠 PATH 会找不到）
JDK_CANDS="$( {
  [ -n "${JAVA_HOME:-}" ] && printf '%s\n' "$JAVA_HOME"
  if command -v javac >/dev/null 2>&1; then
    printf '%s\n' "$(dirname "$(dirname "$(command -v javac)")")"
  fi
  for d in \
    "/c/Program Files/Java"/* \
    "/c/Program Files/Eclipse Adoptium"/* \
    "/c/Program Files/Microsoft"/* \
    "/c/Program Files/Amazon Corretto"/* \
    "/c/Program Files/Zulu"/* \
    "/usr/lib/jvm"/* \
    /Library/Java/JavaVirtualMachines/*/Contents/Home; do
    [ -d "$d" ] && printf '%s\n' "$d"
  done
} 2>/dev/null || true )"

JAVAC=""; JAVAC_MAJOR=0
_oldifs="$IFS"; IFS='
'
for d in $JDK_CANDS; do
  [ -n "$d" ] || continue
  _c="$d/bin/javac$EXE"
  [ -x "$_c" ] || continue
  _m="$(major_of "$_c")"
  if [ "$_m" -gt "$JAVAC_MAJOR" ]; then JAVAC="$_c"; JAVAC_MAJOR="$_m"; fi
done
IFS="$_oldifs"

[ -n "$JAVAC" ] || die "找不到 javac。装个 JDK（Debian/Ubuntu: sudo apt install openjdk-17-jdk-headless；
  macOS: brew install openjdk），或者 export JAVA_HOME=/path/to/jdk"
JDKBIN="$(dirname "$JAVAC")"
KEYTOOL="$JDKBIN/keytool$EXE"
[ -x "$KEYTOOL" ] || die "找不到 keytool，应该在 $JDKBIN 旁边"

# 跑 jar 的 JVM：d8 / apksigner 是 class 55 的，必须 Java 11+
RUNJAVA=""
for c in .jre17/*/bin/java$EXE "$JDKBIN/java$EXE" "${JAVA_HOME:+$JAVA_HOME/bin/java$EXE}" "$(command -v java 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] || continue
  if [ "$(major_of "$c")" -ge 11 ]; then RUNJAVA="$c"; break; fi
done
[ -n "$RUNJAVA" ] || die "d8 / apksigner 需要 Java 11+，但没找到可用的 JVM。
  装一个（Debian/Ubuntu: sudo apt install openjdk-17-jre-headless），
  或把任意 JRE 11+ 解压到 android/.jre17/ 下让脚本自己发现。"

AAPT2="$BT/aapt2$EXE"
ZIPALIGN="$BT/zipalign$EXE"
APKSIGNER_JAR="$BT/lib/apksigner.jar"
D8_JAR="$BT/lib/d8.jar"
for f in "$AAPT2" "$ZIPALIGN" "$APKSIGNER_JAR" "$D8_JAR"; do
  [ -f "$f" ] || die "build-tools 里缺东西：$f"
done

VER_CODE=1
VER_NAME=0.9
OUT="build"
APK_NAME="what2eat-$VER_NAME.apk"
KS="keystore/what2eat.jks"
KS_PASS="what2eat"
KS_ALIAS="what2eat"

echo "==> 环境"
echo "    SDK         $SDK"
echo "    build-tools $BT"
echo "    platform    $PLATFORM"
echo "    javac       $JAVAC (Java $JAVAC_MAJOR)"
echo "    jvm         $RUNJAVA (Java $(major_of "$RUNJAVA"))"

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
if [ "$JAVAC_MAJOR" -ge 9 ]; then
  # JDK 9+ 不让 -source 1.8 配 -bootclasspath，改走 --release + classpath
  "$JAVAC" --release 8 -nowarn -encoding UTF-8 \
    -classpath "$(W "$PLATFORM")" \
    -d "$OUT/classes" \
    java/com/what2eat/app/MainActivity.java
else
  "$JAVAC" -source 1.8 -target 1.8 -nowarn -encoding UTF-8 \
    -bootclasspath "$(W "$PLATFORM")" \
    -d "$OUT/classes" \
    java/com/what2eat/app/MainActivity.java
fi

echo "==> 4/6 转成 dex"
"$RUNJAVA" -cp "$(W "$D8_JAR")" com.android.tools.r8.D8 \
  --release --min-api 21 --lib "$(W "$PLATFORM")" \
  --output "$OUT/dex" \
  "$OUT"/classes/com/what2eat/app/*.class

cp "$OUT/dex/classes.dex" "$OUT/apk/classes.dex"

echo "==> 5/6 塞进 APK 并 zipalign"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$OUT/apk/base.apk" "$OUT/apk/classes.dex" <<'PY'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
print('   classes.dex ->', apk)
PY
elif command -v zip >/dev/null 2>&1; then
  ( cd "$OUT/apk" && zip -q base.apk classes.dex )
  echo "   classes.dex -> $OUT/apk/base.apk"
else
  die "需要 python3 或 zip 命令，才能把 classes.dex 塞进 APK"
fi
"$ZIPALIGN" -f -p 4 "$OUT/apk/base.apk" "$OUT/apk/aligned.apk"

echo "==> 6/6 签名"
mkdir -p keystore
if [ ! -f "$KS" ]; then
  echo "   ⚠ 没找到 $KS，将生成一把新的签名密钥。"
  echo "     换密钥签出来的包没法覆盖安装已有的 app（只能先卸载，数据一起没）。"
  echo "     要沿用旧签名，把原来那台机器上的 android/keystore/what2eat.jks 拷到这个目录再跑。"
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
echo "✅ 出了：$(pwd)/$OUT/$APK_NAME  ($(du -k "$OUT/$APK_NAME" | cut -f1) KB)"
