#!/bin/sh
# 把「打 APK 需要的那点 Android SDK」和一个 JDK 装进 android/ 目录，build.sh 会自动认。
#
#   cd android && sh setup-sdk.sh          # 全装（SDK + JDK 17）
#   sh setup-sdk.sh --sdk-only             # 机器上已经有 JDK 11+ 了，只补 SDK
#   W2E_SDK_MIRROR=https://xxx/android/repository sh setup-sdk.sh   # 换镜像
#
# 为什么不装 sdkmanager：它要 Java 17、要交互同意 licenses、还要能连上一堆 google 域名。
# 这里只下两个 zip（合计约 120 MB），解压到固定位置就完事：
#   build-tools_r34-linux.zip     → aapt2 / zipalign / lib/d8.jar / lib/apksigner.jar
#   platform-34-ext7_r03.zip      → platforms/android-34/android.jar
#
# 装完的目录结构（都在 .gitignore 里，不入库）：
#   android/.sdk/build-tools/34.0.0/…
#   android/.sdk/platforms/android-34/android.jar
#   android/.jdk/jdk-17.0.x+y/…
set -eu
# pipefail 不是 POSIX 的，能开就开
(set -o pipefail) 2>/dev/null && set -o pipefail || true

cd "$(dirname "$0")"

BT_VER=34.0.0
PLAT=android-34
PLAT_ZIP=platform-34-ext7_r03.zip
SDK_DIR="$(pwd)/.sdk"
JDK_DIR="$(pwd)/.jdk"
CACHE="$SDK_DIR/.cache"

WANT_JDK=1
for a in "$@"; do
  case "$a" in
    --sdk-only) WANT_JDK=0 ;;
    --force) rm -rf "$SDK_DIR" "$JDK_DIR" ;;
    -h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf '\xe2\x9c\x97 不认识的参数：%s（试试 --sdk-only）\n' "$a" >&2; exit 2 ;;
  esac
done

ok() { printf '\xe2\x9c\x85 %s\n' "$*"; }
die() { printf '\xe2\x9c\x97 %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }

# ---------------- 平台 ----------------
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  die "需要 curl 或 wget 才能下载（apt install curl）"
fi

OS="$(uname -s)"
case "$OS" in
  Linux) BT_ZIP="build-tools_r34-linux.zip"; JDK_OS=linux ;;
  Darwin) BT_ZIP="build-tools_r34-macosx.zip"; JDK_OS=mac ;;
  *) die "这个脚本只支持 Linux / macOS（当前 $OS）。Windows 请用 Git Bash 跑 build.sh，并自己装 SDK。" ;;
esac

MACH="$(uname -m)"
case "$MACH" in
  x86_64 | amd64) MACH=x64 ;;
  aarch64 | arm64) MACH=aarch64 ;;
  armv7* | armv8*) MACH=arm32 ;;
  *) die "认不出 CPU 架构：$MACH" ;;
esac
if [ "$OS" = Linux ] && [ "$MACH" != x64 ]; then
  die "Google 没发布 linux-$MACH 的 build-tools（只给了 x86_64）。
  在 NAS 上遇到这个，说明机器是 ARM 的：换一台 x86 机器打，或者在 Docker 里跑 x86_64 容器。"
fi
if [ "$OS" = Darwin ] && [ "$MACH" = x64 ]; then
  note "macOS x86_64：build-tools 用的是 x86 包，Apple 芯片上靠 Rosetta 跑。"
fi

# ---------------- 解压能力 ----------------
unzip_to() { # $1 zip  $2 目标目录
  _z="$1"; _d="$2"
  mkdir -p "$_d"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$_z" -d "$_d" && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$_z" "$_d" && return 0
  fi
  if command -v busybox >/dev/null 2>&1 && busybox --list 2>/dev/null | grep -qx unzip; then
    busybox unzip -q -o "$_z" -d "$_d" && return 0
  fi
  if command -v jar >/dev/null 2>&1; then
    ( cd "$_d" && jar xf "$_z" ) && return 0
  fi
  die "没有 unzip / python3 / busybox，解不开 zip（apt install unzip）"
}

# ---------------- 下载 ----------------
GOOGLE="https://dl.google.com/android/repository"
TENCENT="https://mirrors.cloud.tencent.com/AndroidSDK"
SDK_BASES="${W2E_SDK_MIRROR:-} $GOOGLE $TENCENT"

fetch() { # $1 存到哪  $2 zip 文件名  $3.. 依次尝试的 base 地址
  _out="$1"; _name="$2"; shift 2
  if [ -s "$_out" ]; then
    note "已缓存 $(basename "$_out")，跳过下载"
    return 0
  fi
  for _b in "$@"; do
    [ -n "$_b" ] || continue
    note "下载 $_b/$_name"
    if command -v curl >/dev/null 2>&1; then
      curl -fL --retry 3 --connect-timeout 20 -C - -o "$_out" "$_b/$_name" && return 0
    else
      wget -c -O "$_out" "$_b/$_name" && return 0
    fi
    rm -f "$_out"
    note "↳ 这个源不通，换下一个"
  done
  return 1
}

# ================= 1. build-tools =================
step "1/3 build-tools $BT_VER（aapt2 / zipalign / d8 / apksigner）"
if [ -x "$SDK_DIR/build-tools/$BT_VER/aapt2" ]; then
  note "已经有了，跳过"
else
  mkdir -p "$CACHE"
  fetch "$CACHE/$BT_ZIP" "$BT_ZIP" $SDK_BASES ||
    die "build-tools 下载失败。换镜像再试：W2E_SDK_MIRROR=https://你的镜像/android/repository sh setup-sdk.sh"
  rm -rf "$CACHE/tmp"
  unzip_to "$CACHE/$BT_ZIP" "$CACHE/tmp"
  _src="$(cd "$CACHE/tmp" && ls -d */ 2>/dev/null | head -1)"
  _src="${_src%/}"
  [ -n "$_src" ] || die "build-tools 压缩包里没有目录，包可能下坏了（删掉 $CACHE 重来）"
  mkdir -p "$SDK_DIR/build-tools"
  rm -rf "$SDK_DIR/build-tools/$BT_VER"
  mv "$CACHE/tmp/$_src" "$SDK_DIR/build-tools/$BT_VER"
  rm -rf "$CACHE/tmp"
  # zip 里带的权限位 python3 / 某些 unzip 会丢，两个真二进制手动补一下
  chmod +x "$SDK_DIR/build-tools/$BT_VER/aapt2" "$SDK_DIR/build-tools/$BT_VER/zipalign" 2>/dev/null || true
  ok "aapt2 / zipalign 就位"
fi

# ================= 2. platform =================
step "2/3 platforms/$PLAT（android.jar）"
if [ -f "$SDK_DIR/platforms/$PLAT/android.jar" ]; then
  note "已经有了，跳过"
else
  mkdir -p "$CACHE"
  fetch "$CACHE/$PLAT_ZIP" "$PLAT_ZIP" $SDK_BASES ||
    die "platform 下载失败。换镜像再试：W2E_SDK_MIRROR=https://你的镜像/android/repository sh setup-sdk.sh"
  rm -rf "$CACHE/tmp"
  unzip_to "$CACHE/$PLAT_ZIP" "$CACHE/tmp"
  mkdir -p "$SDK_DIR/platforms"
  rm -rf "$SDK_DIR/platforms/$PLAT"
  mv "$CACHE/tmp/$PLAT" "$SDK_DIR/platforms/$PLAT"
  rm -rf "$CACHE/tmp"
  [ -s "$SDK_DIR/platforms/$PLAT/android.jar" ] || die "解出来的 android.jar 是空的，包可能下坏了（删掉 $CACHE 重来）"
  ok "android.jar 就位（$(du -k "$SDK_DIR/platforms/$PLAT/android.jar" | cut -f1) KB）"
fi

# ================= 3. JDK =================
# 版本主号：javac 1.8.0_201 → 8；java 17.0.21 → 17
major_of() {
  _v="$("$1" -version 2>&1 | head -1 | sed -n 's/.*version "\([^"]*\)".*/\1/p')"
  [ -n "$_v" ] || _v="$("$1" -version 2>&1 | head -1 | sed -n 's/.* \([0-9][0-9._]*\).*/\1/p')"
  case "$_v" in
    1.*) _m="$(printf '%s' "$_v" | cut -d. -f2)" ;;
    *) _m="${_v%%.*}" ;;
  esac
  printf '%s' "${_m:-0}"
}

find_jdk() { # 打印一个「javac 有、java 版本 >=11」的 bin 目录
  for _c in \
    "${JAVA_HOME:+$JAVA_HOME/bin/javac}" \
    "$(command -v javac 2>/dev/null || true)" \
    "$JDK_DIR"/*/bin/javac; do
    [ -n "$_c" ] && [ -x "$_c" ] || continue
    _b="$(dirname "$_c")"
    [ -x "$_b/java" ] || continue
    [ "$(major_of "$_b/java")" -ge 11 ] || continue
    printf '%s\n' "$_b"
    return 0
  done
  return 1
}

step "3/3 JDK 17（javac 编 Java、java 跑 d8 / apksigner）"
HAVE_JDK="$(find_jdk || true)"
if [ -n "$HAVE_JDK" ]; then
  note "系统里已经有 $(major_of "$HAVE_JDK/java")：$HAVE_JDK，不装了"
elif [ "$WANT_JDK" = 0 ]; then
  note "--sdk-only：跳过 JDK（build.sh 会再自己找一遍，找不到会报错）"
else
  TUNA="https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/$MACH/$JDK_OS"
  JAVA_TGZ="$CACHE/jdk17.tar.gz"
  mkdir -p "$CACHE"
  if [ -s "$JAVA_TGZ" ]; then
    note "已缓存 jdk17.tar.gz，跳过下载"
  else
    # 先问清华镜像目录里最新的是哪个文件，问不到就退回官方 API（会 302 到 GitHub）
    JDK_NAME="$(curl -fsSL --connect-timeout 20 --max-time 60 "$TUNA/" 2>/dev/null |
      grep -o 'OpenJDK17U-jdk_[A-Za-z0-9_.]*\.tar\.gz' | sort -uV | tail -1 || true)"
    if [ -n "${JDK_NAME:-}" ] && fetch "$JAVA_TGZ" "$JDK_NAME" "$TUNA"; then
      :
    else
      note "清华索引取不到，改走 Adoptium 官方 API"
      curl -fL --retry 3 --connect-timeout 20 -o "$JAVA_TGZ" \
        "https://api.adoptium.net/v3/binary/latest/17/ga/$JDK_OS/$MACH/jdk/hotspot/normal/eclipse" ||
        die "JDK 下载失败。要么手动装一个（Debian/Ubuntu: sudo apt install openjdk-17-jdk-headless），
  要么把任意 JDK 17 解压到 android/.jdk/ 下（里面一个 jdk-17.x 目录即可）"
    fi
  fi
  rm -rf "$JDK_DIR"
  mkdir -p "$JDK_DIR"
  tar -xzf "$JAVA_TGZ" -C "$JDK_DIR"
  HAVE_JDK="$(find_jdk || true)"
  [ -n "$HAVE_JDK" ] || die "JDK 解压后没找到可用的 javac，删掉 $JDK_DIR 和 $CACHE/jdk17.tar.gz 重来一次"
  ok "JDK $(major_of "$HAVE_JDK/java") 就位"
fi
rm -rf "$CACHE/tmp"

# ================= 收尾 =================
printf '\n'
ok "装好了，位置："
note "SDK  $SDK_DIR"
note "       build-tools/$BT_VER + platforms/$PLAT"
if [ -n "$HAVE_JDK" ]; then note "JDK  $HAVE_JDK"; fi
printf '\n   直接打：sh build.sh\n'
printf '   （build.sh 会自动用 android/.sdk 和 android/.jdk，不用 export 任何东西）\n'
printf '   体积：%s\n' "$(du -sh "$SDK_DIR" "$JDK_DIR" 2>/dev/null | tr '\n' ' ')"
printf '   不要了直接：rm -rf .sdk .jdk\n'
