#!/usr/bin/env bash
# 打一个免 Gradle 的 APK：aapt2 出资源包 → javac + d8 出 dex → 塞进 APK → zipalign → apksigner
#
# 用法：./build.sh    或    bash build.sh    或（Linux 上）sh build.sh
#   —— 脚本刻意写成 POSIX shell 兼容的：Debian/Ubuntu 的 sh 是 dash，
#      bash 专有的 pipefail / <(...) 在那儿会直接语法错误。
#
# 依赖（Windows / Linux / macOS 通用）：
#   · Android SDK：build-tools（aapt2、zipalign，外加 lib/d8.jar + lib/apksigner.jar
#     或者 d8 / apksigner 两个包装脚本）+ 任意一个 platform 的 android.jar
#     用 ANDROID_HOME / ANDROID_SDK_ROOT / ANDROID_BASE 指过去，或者放在默认位置
#   · JDK 11+：javac 编 Java、keytool 生成密钥、java 跑 d8 和 apksigner
#     只有 JDK 8 的老机器也能用：把任意 JRE 11+ 解压到 android/.jre17/ 下，脚本会自动挑
#   · 在 NAS 上：工具链装在容器里（/opt/data/android-build/tools），宿主机上直接 sh build.sh，
#     脚本发现自己没工具链、但系统里有 docker + /volume1，就会 docker exec 进容器再跑一遍自己
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
# 顺序：显式环境变量 → NAS 容器里那套共享工具链 → 本目录下的 .sdk（setup-sdk.sh 装的）→ 各平台默认位置
TOOLS_BASE="${ANDROID_BASE:-/opt/data/android-build/tools}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ]; then
  for c in "$TOOLS_BASE" .sdk "/opt/android-sdk" "/usr/lib/android-sdk" \
    "${LOCALAPPDATA:-}/Android/Sdk" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" "$HOME/android-sdk"; do
    if [ -n "$c" ] && [ -d "$c/build-tools" ]; then SDK="$c"; break; fi
  done
fi

# NAS 上这套工具链装在容器里（/opt/data/android-build/tools），宿主机上只有 /volume1。
# 两边挂的是同一个路径，所以直接 docker exec 进容器、在同一个目录再跑一次自己即可。
# 用 W2E_IN_CONTAINER=1 挡住递归。docker 需要 sudo 的机器也认（sudo 有密码时请直接 sudo sh build.sh）。
in_container() {
  [ -z "${W2E_IN_CONTAINER:-}" ] || return 1
  [ -d /volume1 ] || return 1
  command -v docker >/dev/null 2>&1 || return 1
  printf '\xe2\x9c\x97 %s\n' "$1" >&2
  printf '   本机没有工具链，但看到 /volume1 了，转进容器里执行…\n'

  # docker 可能得用 sudo
  _dc=""
  if docker info >/dev/null 2>&1; then
    _dc="docker"
  elif command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    _dc="sudo -n docker"
  else
    printf '   ⚠ docker 命令用不了，错误信息：\n' >&2
    docker info 2>&1 | head -3 | sed 's/^/     /' >&2
    printf '   手动跑（容器名按 docker ps 里的实际名字换）：\n' >&2
    printf "   sudo docker exec -it %s bash -lc 'cd %s && sh build.sh'\n" "${W2E_CONTAINER:-hermes-official}" "$PWD" >&2
    return 1
  fi
  printf '   用 %s\n' "$_dc"

  _names="${W2E_CONTAINER:-} hermes-official"
  for _n in $($_dc ps --format '{{.Names}}' 2>/dev/null || true); do
    case " $_names " in *" $_n "*) ;; *) _names="$_names $_n" ;; esac
  done
  _tried=""
  for _n in $_names; do
    [ -n "$_n" ] || continue
    case " $_tried " in *" $_n "*) continue ;; esac
    _tried="$_tried $_n"
    _err="$($_dc exec "$_n" sh -c 'ls /opt/data/android-build/tools/build-tools/*/aapt2' 2>&1)" || {
      # 停着的容器也提一句，省得干瞪眼
      if $_dc ps -a --format '{{.Name}} {{.State}}' 2>/dev/null | grep -q "^$_n .*\(exited\|created\)"; then
        printf '   容器 [%s] 是停着的，先 %s start %s\n' "$_n" "$_dc" "$_n" >&2
      else
        printf '   容器 [%s] 跳过：%s\n' "$_n" "$(printf '%s' "$_err" | head -1)" >&2
      fi
      continue
    }
    printf '   用容器 [%s]：%s\n' "$_n" "$(printf '%s' "$_err" | head -1)"
    if $_dc exec -i -e W2E_IN_CONTAINER=1 "$_n" bash -lc "cd '$PWD' && sh build.sh"; then
      return 0
    fi
    printf '   容器里也没跑通，看上面的报错。\n' >&2
    return 1
  done
  printf '   没找到带 Android 工具链的容器（试过：%s）。指定：W2E_CONTAINER=容器名 sh build.sh\n' "$_tried" >&2
  return 1
}

if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  in_container "找不到 Android SDK" && exit 0
  die "找不到 Android SDK。
  在这个目录跑一次：sh setup-sdk.sh   （自动下 build-tools + platform，约 120MB）
  或者 export ANDROID_HOME=/path/to/android-sdk"
fi

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
    "$TOOLS_BASE"/jdk* \
    "$PWD"/.jdk/* \
    "$PWD"/.jre17/* \
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

if [ -z "$JAVAC" ]; then
  in_container "找不到 javac" && exit 0
  die "找不到 javac。装个 JDK（Debian/Ubuntu: sudo apt install openjdk-17-jdk-headless；
  macOS: brew install openjdk），或者 export JAVA_HOME=/path/to/jdk，
  或者在本目录跑 sh setup-sdk.sh 让它连 JDK 一起装进 android/.jdk"
fi
JDKBIN="$(dirname "$JAVAC")"
JDKHOME="$(dirname "$JDKBIN")"
KEYTOOL="$JDKBIN/keytool$EXE"
[ -x "$KEYTOOL" ] || die "找不到 keytool，应该在 $JDKBIN 旁边"

# 跑 jar 的 JVM：d8 / apksigner 是 class 55 的，必须 Java 11+
RUNJAVA=""
for c in .jdk/*/bin/java$EXE .jre17/*/bin/java$EXE "$JDKBIN/java$EXE" "${JAVA_HOME:+$JAVA_HOME/bin/java$EXE}" "$(command -v java 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] || continue
  if [ "$(major_of "$c")" -ge 11 ]; then RUNJAVA="$c"; break; fi
done
if [ -z "$RUNJAVA" ]; then
  in_container "d8 / apksigner 需要 Java 11+" && exit 0
  die "d8 / apksigner 需要 Java 11+，但没找到可用的 JVM。
  装一个（Debian/Ubuntu: sudo apt install openjdk-17-jre-headless），
  或把任意 JRE 11+ 解压到 android/.jre17/ 下让脚本自己发现。"
fi

AAPT2="$BT/aapt2$EXE"
ZIPALIGN="$BT/zipalign$EXE"
D8_JAR="$BT/lib/d8.jar"
APKSIGNER_JAR="$BT/lib/apksigner.jar"
[ -f "$AAPT2" ] || die "build-tools 里缺 aapt2：$AAPT2"
[ -f "$ZIPALIGN" ] || die "build-tools 里缺 zipalign：$ZIPALIGN"

# d8 / apksigner 跑法二选一：
#   jar —— 官方 SDK 里的 build-tools 都带 lib/*.jar，用上面挑出来的 JVM 跑，最稳
#   bin —— 精简工具链（NAS 容器里那套只留了 d8 / apksigner 这两个包装脚本）走这条，
#          它们自己会找 java，给它配好 JAVA_HOME 就行
if [ -f "$D8_JAR" ]; then D8_MODE=jar
elif [ -x "$BT/d8" ]; then D8_MODE=bin
else die "build-tools 里既没有 lib/d8.jar 也没有 d8 脚本：$BT"; fi
if [ -f "$APKSIGNER_JAR" ]; then SIGN_MODE=jar
elif [ -x "$BT/apksigner" ]; then SIGN_MODE=bin
else die "build-tools 里既没有 lib/apksigner.jar 也没有 apksigner 脚本：$BT"; fi

d8_run() {
  if [ "$D8_MODE" = jar ]; then
    "$RUNJAVA" -cp "$(W "$D8_JAR")" com.android.tools.r8.D8 "$@"
  else
    JAVA_HOME="$JDKHOME" PATH="$JDKBIN:$PATH" "$BT/d8" "$@"
  fi
}
apksigner_run() {
  if [ "$SIGN_MODE" = jar ]; then
    "$RUNJAVA" -jar "$(W "$APKSIGNER_JAR")" "$@"
  else
    JAVA_HOME="$JDKHOME" PATH="$JDKBIN:$PATH" "$BT/apksigner" "$@"
  fi
}

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
# 两条路：JDK 9+ 走 --release 8（干净，不会混进新 API）；但 java 8 的 -bootclasspath 那套
# 也能用，而且对「android.jar 比 Java 8 新」的情况更宽容，所以 --release 挂了就退回它。
compile_java() {
  if [ "$1" = release ]; then
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
}
if [ "$JAVAC_MAJOR" -ge 9 ]; then
  compile_java release || {
    printf '   --release 8 没编过（多半是 android.jar 的 class 版本比 8 新），换 -bootclasspath 再试\n' >&2
    rm -rf "$OUT/classes"; mkdir -p "$OUT/classes"
    compile_java boot
  }
else
  compile_java boot
fi

echo "==> 4/6 转成 dex"
d8_run --release --min-api 21 --lib "$(W "$PLATFORM")" \
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
apksigner_run sign \
  --ks "$(W "$KS")" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias "$KS_ALIAS" \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$OUT/$APK_NAME" "$OUT/apk/aligned.apk"

apksigner_run verify --print-certs "$OUT/$APK_NAME" | head -4

echo
echo "✅ 出了：$(pwd)/$OUT/$APK_NAME  ($(du -k "$OUT/$APK_NAME" | cut -f1) KB)"
