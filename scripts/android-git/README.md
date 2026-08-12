# Bundled git for Android

Gitty shells out to the system `git` binary. Android has no system git, so to
run Gitty on Android we ship a real `git` inside the APK. This directory builds
it.

This keeps the desktop architecture intact: `git -C <repo> …` still works, so
`git subtree`, `git worktree`, `rebase --autostash` and real `--force-with-lease`
all behave exactly as they do on desktop. A pure-Rust library would have cost us
all of those — `gix` cannot push at all, and libgit2 has neither subtree nor
worktree porcelain.

All of the below was verified on a Galaxy Z Fold 7, Android 16 (SDK 36),
SELinux enforcing, running as an ordinary `untrusted_app`.

## Build

```bash
./scripts/android-git/build.sh
```

Needs the Android NDK **r28+** (16 KB page alignment has been mandatory since
Nov 2025), `gsed`, and perl. Output lands in `.build/dist`:

| File | Goes to | Size |
|---|---|---|
| `jniLibs/arm64-v8a/libgit.so` | `src-tauri/gen/android/app/src/main/jniLibs/` | 3.7 MB |
| `jniLibs/arm64-v8a/libgit-remote-http.so` | same | 8.1 MB |
| `jniLibs/arm64-v8a/libgit-sh-i18n--envsubst.so` | same | 2.1 MB |
| `jniLibs/arm64-v8a/libgit-subtree.so` | same | 26 KB |
| `assets/*` | `src-tauri/gen/android/app/src/main/assets/` | ~260 KB |

About 14 MB for arm64-v8a.

## The rules Android imposes

**Exec is only permitted from `nativeLibraryDir`.** Since Android 10, an app
with `targetSdk >= 29` loses SELinux `execute_no_trans` on its own data
directory. Files packaged under `lib/<abi>/` in the APK are extracted to
`/data/app/…/lib/arm64` labelled `apk_data_file`, which apps *can* execute.
This is verified by a control test in the spike: an identical copy of the binary
placed in `filesDir` is refused with `error=13, Permission denied`.

Requirements, all of which must hold together:

- the file must be named `lib*.so` (both the `lib` prefix and `.so` suffix are
  filtered on — `git.so` ships in the APK but is never extracted)
- `android:extractNativeLibs="true"` in the manifest
- `packaging { jniLibs { useLegacyPackaging = true } }` in Gradle — without it
  AGP leaves the libs compressed in the zip and nothing is written to disk
- the binary must be Bionic-linked and PIE (`interpreter /system/bin/linker64`)

**Hence the symlink farm.** `nativeLibraryDir` forces `lib*.so` naming and a
flat layout, but git resolves its helpers by exact name out of `GIT_EXEC_PATH`
(`git-remote-https`, `git-upload-pack`, …). So at first run the app builds a
farm of ~155 symlinks in `filesDir` pointing back into `nativeLibraryDir`.
Executing *through* those symlinks passes SELinux — this was the one assumption
no public source confirmed, and it is now verified.

**`git-subtree` is a shell script that git execs directly**, so it also has to
live in `nativeLibraryDir` (as `libgit-subtree.so`). By contrast `git-sh-setup`
and `git-sh-i18n` are *sourced*, not exec'd, so they can be ordinary readable
files in the farm.

**Android's own `/system/bin/sh` (mksh) runs `git-subtree` correctly** —
`add --squash`, `pull --squash`, `push` and the `git-subtree-dir:` trailer all
verified. Bundling `dash` is therefore optional. It is still the safer choice
long-term, since `/system/bin` is not a stable app-facing API and varies by OEM;
if you do bundle one, ship it as `libdash.so` and point `SHELL_PATH` at the farm.

## Runtime environment (all of it is load-bearing)

| Variable | Why |
|---|---|
| `PATH` must include the farm | git **re-execs itself by name** for `stash`, `reset`, `update-index`, `maintenance` and `upload-pack`. Without this, `rebase --autostash`, `stash` and local-path fetch all fail with `cannot run …: No such file or directory`. |
| `GIT_EXEC_PATH` = farm | where git looks up helpers |
| `TMPDIR` | Android has no `/tmp`, and git falls back to it unconditionally |
| `HOME` | else `~/.gitconfig` lookups misbehave |
| `GIT_SSL_CAINFO` | see below |
| `GIT_TEMPLATE_DIR` | must exist, or every `init`/`clone` prints a warning |
| `GIT_CONFIG_NOSYSTEM=1` | there is no system config to read |
| `GIT_TERMINAL_PROMPT=0` | as on desktop — never block on a prompt |

The app also needs `<uses-permission android:name="android.permission.INTERNET"/>`:
the git subprocess inherits the app's UID and supplementary GIDs, and network
access is gated on the `inet` GID that permission grants.

## CA certificates

**Bundle Mozilla's `ca-bundle.crt` and point `GIT_SSL_CAINFO` at it.** Measured:

| Strategy | Result |
|---|---|
| nothing configured | `unable to get local issuer certificate` (correct — TLS verification is genuinely on) |
| `GIT_SSL_CAPATH=/apex/com.android.conscrypt/cacerts` | **fails** — Android's hashed cert dir does not match what modern OpenSSL expects |
| `GIT_SSL_CAINFO=<bundled ca-bundle.crt>` | **works** |

The tradeoff is that we own bundle updates rather than tracking Android's
Mainline cert updates.

## Build flags that matter

Beyond the four Termux patches in `patches/`:

- **`NO_GECOS_IN_PWENT=1`** — bionic leaves `pw_gecos` NULL (the NDK header
  annotates it `_Nullable`), and git's `copy_gecos()` dereferences it. Without
  this flag *any* operation that writes a reflog without a configured identity
  segfaults — `git clone` crashes in `ident.c:68`. This is a documented git
  build flag, not a patch.
- **`PTHREAD_LIBS=`** — bionic folds pthread and librt into libc; `-lpthread`
  does not exist and linking fails.
- **`NO_GETTEXT=1` + `USE_GETTEXT_SCHEME=fallthrough`** — selects the
  no-translation path in `git-sh-i18n`. Note this is *not* sufficient to avoid
  `git-sh-i18n--envsubst`: even the fallthrough `eval_gettext` shells out to it,
  so that binary must be shipped too. Without it every `eval_gettext` message
  comes back empty — `git subtree` still succeeds, but its output strings
  disappear, and Gitty matches on those (`"Everything up-to-date"`,
  `"already at commit"`).
- **`NO_RUST=1`** — git 2.55 enables Rust by default. Git 3.0 removes this
  opt-out, at which point the Rust cross-compile has to be made to work.

Only three of git's executables are needed by a client: `git`,
`git-remote-http` and `git-sh-i18n--envsubst`. `git-daemon`,
`git-http-backend`, `git-imap-send`, `git-shell` and `scalar` are all
server-side and are not shipped.

## Where repos have to live

**App-internal storage (`filesDir`, real ext4/f2fs) only.** Git needs symlinks,
hard links and mode bits; shared storage and `/sdcard/Android/data/<pkg>/files`
are FUSE-emulated and provide none of them. It is the same reason Termux keeps
`$HOME` on internal storage. `MANAGE_EXTERNAL_STORAGE` does not help — it grants
reach into a filesystem that still cannot host a repo.

`core.symlinks=false` + `core.filemode=false` (the Git-for-Windows approach) may
make shared storage workable, but FUSE passthrough does not accelerate metadata
operations, and `git status` is almost entirely metadata — expect it to be slow.
Untested so far.

Consequence: Gitty on Android owns a repo store and import/export is an explicit
copy. `discovery.rs` (scanning dev directories), `runner.rs` (npm/cargo tasks)
and `editors.rs` (launching IDEs) have no Android equivalent.

## How it is wired into Gitty

`src-tauri/src/git_bin.rs` is the single seam. `git_bin::command()` replaces
every `Command::new("git")` in `lib.rs` and `summarize.rs`; on desktop it is
still literally `git` from `PATH`, so desktop behaviour is unchanged.
`git_bin::init()` runs from Tauri's `setup` hook and builds the farm on first
launch (idempotent, so it also repairs itself after an app update moves
`nativeLibraryDir`).

Notes for anyone touching this:

- **`gen/android` is source.** Tauri generates it but we edit it, so it is
  committed. Re-running `tauri android init` will overwrite the manifest and
  `build.gradle.kts` — re-apply `minSdk 28`, `useLegacyPackaging`,
  `extractNativeLibs`, `resizeableActivity`, the extended `configChanges`, and
  the non-required touchscreen feature.
- **`app_data_dir()` on Android returns the data dir root**
  (`/data/user/0/<pkg>`), not `files/`. The farm therefore lands at
  `/data/user/0/<pkg>/usr/libexec/git-core`.
- **reqwest uses rustls on Android only.** Its default TLS pulls in
  `openssl-sys`, which has no cross-compilable OpenSSL under the NDK. Desktop
  keeps the system TLS stack — see the target-specific dependencies in
  `Cargo.toml`.
- **`minSdk` is 28** because the bundled git is built against API 28.

Build and install:

```bash
./scripts/android-git/build.sh                          # git + deps, installs into gen/android
npx tauri android build --debug --target aarch64 --apk
```

Verify the farm on a connected device:

```bash
adb shell run-as app.gitty.desktop sh -c 'ls usr/libexec/git-core | wc -l'
```

## Still open

- **Getting repos into the app.** Gitty's `add_repo` / `init_repo` take
  arbitrary paths, which does not map onto Android: there is no picker that
  yields a real filesystem path a repo can live at. Needs a product decision —
  clone-into-the-store is the obvious default, import/export second.
- **`discovery.rs` / `runner.rs` / `editors.rs`** currently degrade rather than
  fail cleanly on Android; they should be feature-gated out.
- **Right-click and hover in DeX** are untested. Note Samsung reports touch
  devices as having `hover: hover`, so do not gate desktop-mode UI on that media
  query — only `(pointer: coarse)` / `(pointer: fine)` discriminate.
- **Git 3.0 removes `NO_RUST`**, so the Rust cross-compile will have to work.
- **`git-remote-http` is 8.1 MB** because OpenSSL is linked statically. Trimming
  the OpenSSL build would cut most of that.
