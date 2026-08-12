//! Resolves the `git` binary and the environment it needs.
//!
//! On desktop this is just `git` from `PATH`, exactly as before.
//!
//! Android has no system git, so we ship one inside the APK. Three constraints
//! shape everything here, all verified on-device (see
//! `scripts/android-git/README.md`):
//!
//!   1. Android only permits exec from the app's `nativeLibraryDir`, so the
//!      executables are packaged as `lib*.so` and live there.
//!   2. git resolves its helpers by *exact name* out of `GIT_EXEC_PATH`
//!      (`git-remote-https`, `git-upload-pack`, …), which `lib*.so` naming
//!      cannot express — so first run builds a farm of symlinks in the app's
//!      data dir pointing back into `nativeLibraryDir`.
//!   3. git re-execs *itself* by name for `stash`, `reset`, `update-index`,
//!      `maintenance` and `upload-pack`, so the farm must also be on `PATH`.
//!      Without that, `rebase --autostash` and `stash` fail outright.

use std::process::Command;

/// A `git` command with the platform's binary and base environment applied.
/// Callers add `-C <repo>` and their own args as before.
pub fn command() -> Command {
    #[cfg(target_os = "android")]
    {
        android::command()
    }
    #[cfg(not(target_os = "android"))]
    {
        let mut cmd = Command::new("git");
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        cmd
    }
}

/// Prepare the bundled git. No-op off Android.
#[allow(unused_variables)]
pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android::init(app)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[cfg(target_os = "android")]
mod android {
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::OnceLock;
    use tauri::Manager;

    // Small support files are embedded rather than shipped as Android assets:
    // assets are only reachable through the Java AssetManager, which Rust
    // cannot read without JNI. Executables still have to be real files in
    // nativeLibraryDir, because they have to be exec'd.
    const CA_BUNDLE: &[u8] = include_bytes!("../android-git-payload/ca-bundle.crt");
    const SH_SETUP: &[u8] = include_bytes!("../android-git-payload/git-sh-setup");
    const SH_I18N: &[u8] = include_bytes!("../android-git-payload/git-sh-i18n");
    const FARM_NAMES: &str = include_str!("../android-git-payload/farm-names.txt");

    struct GitEnv {
        git: PathBuf,
        farm: PathBuf,
        home: PathBuf,
        tmp: PathBuf,
        ca: PathBuf,
        templates: PathBuf,
    }

    static ENV: OnceLock<GitEnv> = OnceLock::new();

    pub fn command() -> Command {
        let env = ENV
            .get()
            .expect("git_bin::init must run before any git command");
        let mut cmd = Command::new(&env.git);
        // git re-execs itself by name, so the farm has to be on PATH as well
        // as in GIT_EXEC_PATH.
        cmd.env(
            "PATH",
            format!("{}:/system/bin", env.farm.display()),
        );
        cmd.env("GIT_EXEC_PATH", &env.farm);
        cmd.env("HOME", &env.home);
        // Android has no /tmp and git falls back to it unconditionally.
        cmd.env("TMPDIR", &env.tmp);
        cmd.env("GIT_SSL_CAINFO", &env.ca);
        cmd.env("GIT_TEMPLATE_DIR", &env.templates);
        cmd.env("GIT_CONFIG_NOSYSTEM", "1");
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        cmd
    }

    pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
        if ENV.get().is_some() {
            return Ok(());
        }
        let native = native_lib_dir()
            .ok_or_else(|| "Could not locate the bundled git in nativeLibraryDir.".to_string())?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|err| format!("Could not resolve the app data directory: {err}"))?;

        let root = data.join("usr");
        let farm = root.join("libexec/git-core");
        let home = data.join("home");
        let tmp = data.join("tmp");
        let templates = root.join("templates");
        let ca = root.join("certs/ca-bundle.crt");

        for dir in [&farm, &home, &tmp, &templates] {
            fs::create_dir_all(dir)
                .map_err(|err| format!("Could not create {}: {err}", dir.display()))?;
        }
        fs::create_dir_all(ca.parent().unwrap())
            .map_err(|err| format!("Could not create the cert directory: {err}"))?;

        write_if_changed(&ca, CA_BUNDLE)?;
        // sourced by git-subtree, never exec'd, so plain files are fine here
        write_if_changed(&farm.join("git-sh-setup"), SH_SETUP)?;
        write_if_changed(&farm.join("git-sh-i18n"), SH_I18N)?;

        // Every builtin name git may exec out of GIT_EXEC_PATH.
        for name in FARM_NAMES.lines().map(str::trim).filter(|n| !n.is_empty()) {
            relink(&farm.join(name), &native.join("libgit.so"))?;
        }
        // Separate binaries, plus git-subtree which is a shell script git execs
        // directly via its shebang -- so it must live in nativeLibraryDir too.
        relink(
            &farm.join("git-remote-http"),
            &native.join("libgit-remote-http.so"),
        )?;
        relink(
            &farm.join("git-remote-https"),
            &native.join("libgit-remote-http.so"),
        )?;
        relink(&farm.join("git-subtree"), &native.join("libgit-subtree.so"))?;
        // Required even with USE_GETTEXT_SCHEME=fallthrough: git's fallthrough
        // eval_gettext still shells out to this, and without it every message
        // it produces comes back empty.
        relink(
            &farm.join("git-sh-i18n--envsubst"),
            &native.join("libgit-sh-i18n--envsubst.so"),
        )?;

        let _ = ENV.set(GitEnv {
            git: farm.join("git"),
            farm,
            home,
            tmp,
            ca,
            templates,
        });
        Ok(())
    }

    /// The APK's extracted native library directory. Found by looking at our
    /// own mapped libraries and picking the directory that holds the bundled
    /// git -- Tauri exposes no API for this.
    fn native_lib_dir() -> Option<PathBuf> {
        let maps = fs::read_to_string("/proc/self/maps").ok()?;
        for line in maps.lines() {
            let Some(idx) = line.find(" /") else { continue };
            let path = line[idx + 1..].trim();
            if !path.ends_with(".so") {
                continue;
            }
            let dir = Path::new(path).parent()?;
            if dir.join("libgit.so").is_file() {
                return Some(dir.to_path_buf());
            }
        }
        None
    }

    fn write_if_changed(path: &Path, contents: &[u8]) -> Result<(), String> {
        if let Ok(existing) = fs::read(path) {
            if existing == contents {
                return Ok(());
            }
        }
        fs::write(path, contents)
            .map_err(|err| format!("Could not write {}: {err}", path.display()))
    }

    fn relink(link: &Path, target: &Path) -> Result<(), String> {
        if fs::symlink_metadata(link).is_ok() {
            let _ = fs::remove_file(link);
        }
        symlink(target, link)
            .map_err(|err| format!("Could not link {}: {err}", link.display()))
    }
}
