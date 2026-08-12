#!/usr/bin/env bash
# Cross-compile git (plus OpenSSL and libcurl) for aarch64-linux-android, and
# lay the result out for packaging into Gitty's APK.
#
# Android permits exec only from an app's nativeLibraryDir, so every real
# executable must be packaged as lib*.so under jniLibs. See README.md.
#
#   ./build.sh              # build everything
#   AGIT_WORK=/some/dir ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${AGIT_WORK:-$HERE/.build}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK="${ANDROID_NDK:-$SDK/ndk/28.2.13676358}"       # r28+ required: 16 KB page alignment
API="${AGIT_API:-28}"                              # Android 9; gives getrandom + sync_file_range
ABI=aarch64-linux-android

GIT_VER="${GIT_VER:-2.55.0}"
OPENSSL_VER="${OPENSSL_VER:-3.5.7}"
CURL_VER="${CURL_VER:-8.21.0}"

SRC="$WORK/src"; DEPS="$WORK/deps"; STAGE="$WORK/stage"; DIST="$WORK/dist"
PREFIX=/data/local/tmp/agit                        # only a build-time default; the
                                                   # app sets GIT_EXEC_PATH at runtime
TC_HOST="$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/ | head -1)"
export PATH="$TC_HOST/bin:$PATH"
export ANDROID_NDK_ROOT="$NDK"
export CC="$TC_HOST/bin/${ABI}${API}-clang"
export AR="$TC_HOST/bin/llvm-ar"
export RANLIB="$TC_HOST/bin/llvm-ranlib"
STRIP="$TC_HOST/bin/llvm-strip"

mkdir -p "$SRC" "$DEPS" "$DIST"
command -v gsed >/dev/null || { echo "need gsed (brew install gnu-sed)"; exit 1; }

fetch() { [ -f "$SRC/$2" ] || curl -fsSL -o "$SRC/$2" "$1"; }

# ---------------------------------------------------------------- OpenSSL ---
if [ ! -f "$DEPS/lib/libssl.a" ]; then
  fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VER/openssl-$OPENSSL_VER.tar.gz" "openssl-$OPENSSL_VER.tar.gz"
  rm -rf "$SRC/openssl-$OPENSSL_VER"; tar xf "$SRC/openssl-$OPENSSL_VER.tar.gz" -C "$SRC"
  ( cd "$SRC/openssl-$OPENSSL_VER"
    ./Configure android-arm64 -D__ANDROID_API__=$API no-shared no-tests no-docs \
      --prefix="$DEPS" --openssldir="$DEPS/ssl" >/dev/null
    make -j"$(sysctl -n hw.ncpu)" >/dev/null && make install_sw >/dev/null )
  echo "built openssl $OPENSSL_VER"
fi

# ------------------------------------------------------------------- curl ---
if [ ! -f "$DEPS/lib/libcurl.a" ]; then
  fetch "https://curl.se/download/curl-$CURL_VER.tar.xz" "curl-$CURL_VER.tar.xz"
  rm -rf "$SRC/curl-$CURL_VER"; tar xf "$SRC/curl-$CURL_VER.tar.xz" -C "$SRC"
  # No compiled-in CA path: the on-device location contains the package name,
  # so GIT_SSL_CAINFO supplies it at runtime.
  ( cd "$SRC/curl-$CURL_VER"
    ./configure --host=$ABI --prefix="$DEPS" --with-openssl="$DEPS" --with-zlib \
      --disable-shared --enable-static --without-ca-bundle --without-ca-path \
      --without-libpsl --without-libidn2 --without-brotli --without-zstd \
      --without-nghttp2 --without-ngtcp2 \
      --disable-ldap --disable-ldaps --disable-rtsp --disable-dict --disable-telnet \
      --disable-tftp --disable-pop3 --disable-imap --disable-smtp --disable-gopher \
      --disable-mqtt --disable-smb --disable-manual --disable-docs >/dev/null
    make -j"$(sysctl -n hw.ncpu)" >/dev/null && make install >/dev/null )
  echo "built curl $CURL_VER"
fi

# -------------------------------------------------------------------- git ---
GITSRC="$SRC/git-$GIT_VER"
if [ ! -d "$GITSRC" ]; then
  fetch "https://mirrors.kernel.org/pub/software/scm/git/git-$GIT_VER.tar.xz" "git-$GIT_VER.tar.xz"
  tar xf "$SRC/git-$GIT_VER.tar.xz" -C "$SRC"
  for p in compat-posix.h disable-fdsan run-command.c config.c; do
    patch -d "$GITSRC" -p1 --forward --silent < "$HERE/patches/$p.patch" \
      || { echo "patch $p failed"; exit 1; }
  done
  echo "extracted + patched git $GIT_VER"
fi

# git's SHELL_PATH is overloaded: it is both the interpreter used to run
# build-time generators on the HOST and the shell baked into script shebangs
# and -DSHELL_PATH for the TARGET. Termux sidesteps this by making the target
# path exist on the build machine; we cannot create /system on macOS, so split
# the variable instead.
if ! grep -q BUILD_SHELL_PATH "$GITSRC/Makefile"; then
  gsed -i \
    -e 's|^SHELL_PATH_SQ = |BUILD_SHELL_PATH ?= /bin/sh\nSHELL_PATH_SQ = |' \
    -e 's|^SHELL = \$(SHELL_PATH)$|SHELL = $(BUILD_SHELL_PATH)|' \
    -e 's|\$(QUIET_GEN)\$(SHELL_PATH) |$(QUIET_GEN)$(BUILD_SHELL_PATH) |g' \
    "$GITSRC/Makefile"
  gsed -i -e 's|^\$(SHELL_PATH) "\$(1)/GIT-VERSION-GEN"|$(BUILD_SHELL_PATH) "$(1)/GIT-VERSION-GEN"|' \
    "$GITSRC/shared.mak"
fi

MAKEARGS=(
  CC="$CC" AR="$AR" RANLIB="$RANLIB"
  uname_S=Linux                       # host is Darwin; pick git's Linux profile
  prefix="$PREFIX"
  SHELL_PATH=/system/bin/sh           # Android's mksh; runs git-subtree fine
  BUILD_SHELL_PATH=/bin/sh
  CURLDIR="$DEPS"
  CURL_CONFIG="$DEPS/bin/curl-config"
  CURL_LDFLAGS="$("$DEPS/bin/curl-config" --static-libs)"
  NO_GETTEXT=1 NO_ICONV=1 NO_EXPAT=1 NO_OPENSSL=1
  NO_TCLTK=1 NO_PERL=1 NO_PYTHON=1
  NO_RUST=1                           # git 3.0 removes this opt-out; revisit then
  NO_INSTALL_HARDLINKS=1 INSTALL_SYMLINKS=1
  NO_REGEX=1
  CSPRNG_METHOD=getrandom
  NO_GECOS_IN_PWENT=1                 # bionic leaves pw_gecos NULL -> git segfaults
  USE_GETTEXT_SCHEME=fallthrough      # keeps shell helpers off git-sh-i18n--envsubst
  PTHREAD_LIBS=                       # bionic folds pthread/librt into libc
  LINK_FUZZ_PROGRAMS=
)

rm -rf "$STAGE"; mkdir -p "$STAGE" "$GITSRC/t/unit-tests/bin"
make -C "$GITSRC" -j"$(sysctl -n hw.ncpu)" "${MAKEARGS[@]}" DESTDIR="$STAGE" install
make -C "$GITSRC/contrib/subtree" "${MAKEARGS[@]}" DESTDIR="$STAGE" install

# ------------------------------------------------------------ dist layout ---
S="$STAGE$PREFIX"
rm -rf "$DIST"; mkdir -p "$DIST/jniLibs/arm64-v8a" "$DIST/assets"

# Executables -- and git-subtree, which git execs directly via its shebang --
# must live in nativeLibraryDir, so they are named lib*.so.
cp "$S/bin/git"                          "$DIST/jniLibs/arm64-v8a/libgit.so"
cp "$S/libexec/git-core/git-remote-http" "$DIST/jniLibs/arm64-v8a/libgit-remote-http.so"
cp "$S/libexec/git-core/git-subtree"     "$DIST/jniLibs/arm64-v8a/libgit-subtree.so"
# Required even with USE_GETTEXT_SCHEME=fallthrough: git-sh-i18n's fallthrough
# eval_gettext still shells out to `git sh-i18n--envsubst`. Without it every
# eval_gettext message comes back empty, which breaks the output strings Gitty
# matches on after git subtree.
cp "$S/libexec/git-core/git-sh-i18n--envsubst" \
                                         "$DIST/jniLibs/arm64-v8a/libgit-sh-i18n--envsubst.so"
"$STRIP" --strip-unneeded "$DIST/jniLibs/arm64-v8a/libgit.so" \
                          "$DIST/jniLibs/arm64-v8a/libgit-remote-http.so" \
                          "$DIST/jniLibs/arm64-v8a/libgit-sh-i18n--envsubst.so"

# Sourced, never exec'd -> ordinary readable files are fine in filesDir.
cp "$S/libexec/git-core/git-sh-setup" "$S/libexec/git-core/git-sh-i18n" "$DIST/assets/"
cp -R "$S/share/git-core/templates" "$DIST/assets/templates"
curl -fsSL -o "$DIST/assets/ca-bundle.crt" https://curl.se/ca/cacert.pem

# Every name git may exec out of GIT_EXEC_PATH; the app recreates these as
# symlinks at runtime because nativeLibraryDir cannot hold them.
( cd "$S/libexec/git-core" && for f in *; do [ -L "$f" ] && echo "$f"; done ) \
  > "$DIST/assets/farm-names.txt"

# ------------------------------------------------------------- install -----
# Executables go into the Android project's jniLibs. The small support files go
# into src-tauri/android-git-payload/, where git_bin.rs embeds them with
# include_bytes! -- Android assets are only reachable via the Java
# AssetManager, which the Rust side cannot read.
APP="$HERE/../../src-tauri/gen/android/app/src/main"
PAYLOAD="$HERE/../../src-tauri/android-git-payload"
if [ -d "$HERE/../../src-tauri/gen/android" ]; then
  mkdir -p "$APP/jniLibs/arm64-v8a"
  cp "$DIST/jniLibs/arm64-v8a/"*.so "$APP/jniLibs/arm64-v8a/"
  echo "installed jniLibs -> $APP/jniLibs/arm64-v8a"
else
  echo "note: src-tauri/gen/android not initialised; skipping jniLibs install"
fi
mkdir -p "$PAYLOAD"
cp "$DIST/assets/ca-bundle.crt" "$DIST/assets/git-sh-setup" \
   "$DIST/assets/git-sh-i18n"  "$DIST/assets/farm-names.txt" "$PAYLOAD/"
echo "installed payload  -> $PAYLOAD"

echo
echo "dist -> $DIST"
ls -lh "$DIST/jniLibs/arm64-v8a"
echo "farm entries: $(wc -l < "$DIST/assets/farm-names.txt")"
