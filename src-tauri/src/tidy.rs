//! Finding finished folders across every repository at once.
//!
//! The per-repository check ([`crate::scan_worktree_cleanup`]) answers for one
//! project, which is the right shape when you are already looking at that
//! project. It is the wrong shape for the thing people actually accumulate:
//! agent tooling opens a folder per task and never closes one, so the folders
//! pile up in repositories you have no reason to visit. Finding them one
//! repository at a time means never finding them.
//!
//! This is a streamed background scan rather than one call, for the same reason
//! discovery is: a working-tree walk per folder across every saved repository is
//! seconds of work, and the sizes are minutes. Results are emitted per
//! repository as they land, and sizes trail in afterwards, so the list is
//! usable long before either finishes.

use crate::{same_path, scan_worktree_cleanup_blocking, CleanupVerdict, WorktreeCleanupEntry};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Emitter, Manager};

/// How many repositories are scanned at once. Each one already fans out across
/// its own folders, so this is a ceiling on threads rather than a target.
const REPO_CONCURRENCY: usize = 4;

/// Cancellation is checked between directory entries during the size walk, not
/// only between folders — a single `node_modules` is millions of entries and
/// would otherwise keep working long after the user closed the panel.
const CANCEL_CHECK_INTERVAL: usize = 4096;

#[derive(Default)]
pub struct TidyScan {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    next_id: AtomicU64,
}

/// One repository's answer. `error` rather than dropping the repository
/// silently: a folder that is missing because its drive is not mounted looks
/// exactly like a repository with nothing to tidy, and the two need to read
/// differently.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TidyRepoResult {
    scan_id: u64,
    repo_name: String,
    repo_path: String,
    entries: Vec<WorktreeCleanupEntry>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TidyFolderSize {
    scan_id: u64,
    path: String,
    bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TidyProgress {
    scan_id: u64,
    scanned: usize,
    total: usize,
}

fn repo_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("Repository")
        .to_string()
}

/// Bytes held by a folder, walked without following symlinks.
///
/// Apparent size, not disk usage: this exists to say "about 30 GB", and summing
/// file lengths gets there without the per-filesystem block arithmetic `du`
/// does. Symlinks are never followed — a folder that links to its own parent
/// would otherwise walk forever.
fn folder_size(path: &Path, cancel: &AtomicBool) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    let mut seen = 0usize;

    while let Some(dir) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            return total;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen % CANCEL_CHECK_INTERVAL == 0 && cancel.load(Ordering::Relaxed) {
                return total;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }

    total
}

/// The folder Gitty currently has open, forced out of contention.
///
/// The per-repository panel gets this free: it judges one repository and skips
/// the checkout it was asked about. Here the scan is driven from the saved
/// repository list, which holds original clones — so when the user has opened a
/// linked folder, that folder is judged as just another candidate and can be
/// offered up while they are standing in it. Removing it would pull the
/// directory out from under the open window.
fn protect_open_folder(entries: &mut [WorktreeCleanupEntry], open_path: Option<&Path>) {
    let Some(open_path) = open_path else {
        return;
    };
    for entry in entries.iter_mut() {
        if same_path(Path::new(&entry.path), open_path) {
            entry.verdict = CleanupVerdict::Keep;
            entry.reason = "You have this folder open in Gitty right now.".to_string();
        }
    }
}

fn scan_all(
    app: &AppHandle,
    scan_id: u64,
    paths: Vec<String>,
    open_path: Option<PathBuf>,
    cancel: Arc<AtomicBool>,
) {
    let total = paths.len();
    let scanned = AtomicU64::new(0);
    let mut removable: Vec<String> = Vec::new();
    // Borrowed once rather than per chunk: the workers only read it, and taking
    // it inside the loop would move it into the first chunk's closure.
    let open_path = open_path.as_deref();

    for chunk in paths.chunks(REPO_CONCURRENCY) {
        if cancel.load(Ordering::Relaxed) {
            return;
        }

        let results: Vec<TidyRepoResult> = thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|path| {
                    let app = app.clone();
                    let cancel = cancel.clone();
                    let scanned = &scanned;
                    scope.spawn(move || {
                        if cancel.load(Ordering::Relaxed) {
                            return None;
                        }
                        let outcome = scan_worktree_cleanup_blocking(path.clone());
                        let result = match outcome {
                            Ok(mut entries) => {
                                protect_open_folder(&mut entries, open_path);
                                TidyRepoResult {
                                    scan_id,
                                    repo_name: repo_display_name(Path::new(path)),
                                    repo_path: path.clone(),
                                    entries,
                                    error: None,
                                }
                            }
                            Err(message) => TidyRepoResult {
                                scan_id,
                                repo_name: repo_display_name(Path::new(path)),
                                repo_path: path.clone(),
                                entries: Vec::new(),
                                error: Some(message),
                            },
                        };

                        // Emitted from inside the worker so a repository shows up
                        // the moment it is done, rather than waiting on the
                        // slowest one in its group.
                        if !cancel.load(Ordering::Relaxed) {
                            let _ = app.emit("tidy-scan-repo", result.clone());
                            let done = scanned.fetch_add(1, Ordering::Relaxed) as usize + 1;
                            let _ = app.emit(
                                "tidy-scan-progress",
                                TidyProgress {
                                    scan_id,
                                    scanned: done,
                                    total,
                                },
                            );
                        }
                        Some(result)
                    })
                })
                .collect();

            handles
                .into_iter()
                .filter_map(|handle| handle.join().ok().flatten())
                .collect()
        });

        for result in results {
            removable.extend(
                result
                    .entries
                    .iter()
                    .filter(|entry| entry.verdict != CleanupVerdict::Keep && !entry.missing)
                    .map(|entry| entry.path.clone()),
            );
        }
    }

    if cancel.load(Ordering::Relaxed) {
        return;
    }
    let _ = app.emit(
        "tidy-scan-finished",
        TidyProgress {
            scan_id,
            scanned: total,
            total,
        },
    );

    // Sizes are the reason to act on any of this, and also the slowest part of
    // it by a wide margin, so they trail the list rather than gating it.
    for path in removable {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let bytes = folder_size(Path::new(&path), &cancel);
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let _ = app.emit(
            "tidy-scan-size",
            TidyFolderSize {
                scan_id,
                path,
                bytes,
            },
        );
    }

    let _ = app.emit("tidy-scan-sizes-finished", scan_id);
}

/// Begin a scan, superseding any scan already running. Returns the id every
/// event from this scan carries, so the caller can drop events from a scan it
/// has moved on from.
#[tauri::command]
pub fn start_tidy_scan(
    app: AppHandle,
    paths: Vec<String>,
    open_path: Option<String>,
) -> Result<u64, String> {
    let state = app.state::<TidyScan>();
    let cancel = Arc::new(AtomicBool::new(false));
    let scan_id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    if let Ok(mut current) = state.cancel.lock() {
        if let Some(previous) = current.take() {
            previous.store(true, Ordering::Relaxed);
        }
        *current = Some(cancel.clone());
    }

    let paths: Vec<String> = paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty() && PathBuf::from(path).is_dir())
        .collect();

    let open_path = open_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);

    let handle = app.clone();
    thread::spawn(move || {
        scan_all(&handle, scan_id, paths, open_path, cancel);
    });

    Ok(scan_id)
}

/// Stop the running scan. Called when the panel closes, so a size walk over
/// tens of gigabytes does not keep going for a screen nobody is looking at.
#[tauri::command]
pub fn cancel_tidy_scan(app: AppHandle) {
    let state = app.state::<TidyScan>();
    if let Ok(mut current) = state.cancel.lock() {
        if let Some(previous) = current.take() {
            previous.store(true, Ordering::Relaxed);
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn folder_size_sums_files_without_following_symlinks() {
        let root = std::env::temp_dir().join(format!("gitty-tidy-size-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("dirs");
        fs::write(root.join("a.bin"), vec![0u8; 1000]).expect("write");
        fs::write(nested.join("b.bin"), vec![0u8; 2000]).expect("write");

        let cancel = AtomicBool::new(false);
        assert_eq!(folder_size(&root, &cancel), 3000);

        // A link back to the root would walk forever if it were followed, and
        // its target's bytes are already counted where they actually live.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&root, nested.join("loop")).expect("symlink");
            assert_eq!(folder_size(&root, &cancel), 3000);
        }

        let _ = fs::remove_dir_all(&root);
    }

    fn entry(path: &str) -> WorktreeCleanupEntry {
        WorktreeCleanupEntry {
            path: path.to_string(),
            branch: Some("feature".to_string()),
            verdict: CleanupVerdict::Safe,
            reason: "Everything on feature is already in main.".to_string(),
            warnings: Vec::new(),
            missing: false,
            last_used_at: None,
        }
    }

    /// The per-repository panel skips the checkout it was asked about. This scan
    /// is driven from the saved repository list, which holds original clones, so
    /// a linked folder the user has opened arrives looking like any other
    /// candidate — and being offered the folder you are standing in is the one
    /// suggestion this feature must never make.
    #[test]
    fn the_folder_open_in_gitty_is_never_offered() {
        let root = std::env::temp_dir().join(format!("gitty-tidy-open-{}", std::process::id()));
        let open = root.join("feature");
        let other = root.join("spare");
        fs::create_dir_all(&open).expect("dirs");
        fs::create_dir_all(&other).expect("dirs");

        let mut entries = vec![
            entry(&open.to_string_lossy()),
            entry(&other.to_string_lossy()),
        ];
        protect_open_folder(&mut entries, Some(&open));

        assert_eq!(entries[0].verdict, CleanupVerdict::Keep);
        assert!(entries[0].reason.contains("open in Gitty"), "got: {}", entries[0].reason);
        assert_eq!(
            entries[1].verdict,
            CleanupVerdict::Safe,
            "the other folder is unaffected"
        );

        let _ = fs::remove_dir_all(&root);
    }

    /// `/tmp` and `/private/tmp` are the same directory on macOS, and the open
    /// path arrives from a different source than the scan's, so the two forms
    /// meet here routinely.
    #[test]
    fn the_open_folder_is_matched_through_path_aliases() {
        let root = std::env::temp_dir().join(format!("gitty-tidy-alias-{}", std::process::id()));
        let open = root.join("feature");
        fs::create_dir_all(&open).expect("dirs");

        let mut entries = vec![entry(&open.to_string_lossy())];
        let canonical = fs::canonicalize(&open).expect("canonicalize");
        protect_open_folder(&mut entries, Some(&canonical));

        assert_eq!(entries[0].verdict, CleanupVerdict::Keep);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_cancelled_size_walk_stops_early() {
        let root = std::env::temp_dir().join(format!("gitty-tidy-cancel-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("dirs");
        fs::write(root.join("a.bin"), vec![0u8; 1000]).expect("write");

        let cancel = AtomicBool::new(true);
        assert_eq!(folder_size(&root, &cancel), 0);

        let _ = fs::remove_dir_all(&root);
    }
}
