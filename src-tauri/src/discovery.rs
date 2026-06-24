use crate::RepoEntry;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, Manager};

const MAX_DEPTH: usize = 12;

const SKIP_DIR_NAMES: &[&str] = &[
    "node_modules",
    "target",
    "build",
    "dist",
    ".next",
    "vendor",
    "Pods",
    "DerivedData",
    "Library",
    "Applications",
    ".Trash",
    "Caches",
    "Cache",
    ".cargo",
    ".npm",
    ".pnpm",
    ".yarn",
    ".venv",
    "venv",
    "__pycache__",
    ".gradle",
    ".idea",
    ".vscode",
    "tmp",
    "temp",
];

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRepoEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub last_edited_at: u64,
}

pub struct RepoDiscovery {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl Default for RepoDiscovery {
    fn default() -> Self {
        Self {
            cancel: Mutex::new(None),
        }
    }
}

fn modified_millis(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

/// Best-effort "last worked on" signal using at most two stat calls.
fn repo_last_edited_at(path: &Path) -> u64 {
    modified_millis(&path.join(".git/logs/HEAD"))
        .or_else(|| modified_millis(&path.join(".git")))
        .or_else(|| modified_millis(path))
        .unwrap_or(0)
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIR_NAMES
        .iter()
        .any(|skip| name.eq_ignore_ascii_case(skip))
}

fn quick_repo_entry(path: &Path) -> Option<RepoEntry> {
    if !path.join(".git").exists() {
        return None;
    }

    let canonical = fs::canonicalize(path).ok()?;
    let path_string = canonical.to_string_lossy().to_string();
    let name = canonical
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("Repository")
        .to_string();

    Some(RepoEntry {
        id: path_string.clone(),
        name,
        path: path_string,
    })
}

fn discovery_roots(home: &Path, saved_paths: &[String]) -> Vec<PathBuf> {
    let mut roots = vec![
        home.join("Developer"),
        home.join("Projects"),
        home.join("Code"),
        home.join("Sites"),
        home.join("Work"),
        home.join("src"),
        home.join("repos"),
        home.join("github"),
        home.join("GitHub"),
        home.join("workspace"),
        home.join("workspaces"),
        home.join("Desktop"),
        home.join("go"),
        home.join("Documents"),
        home.to_path_buf(),
    ];

    for saved in saved_paths {
        let path = PathBuf::from(saved);
        if let Some(parent) = path.parent() {
            roots.push(parent.to_path_buf());
        }
        roots.push(path);
    }

    roots.sort();
    roots.dedup();
    roots.retain(|root| root.is_dir());
    roots
}

fn resolve_scan_dir(dir: &Path) -> Option<PathBuf> {
    fs::canonicalize(dir).ok().or_else(|| {
        if dir.is_dir() {
            Some(dir.to_path_buf())
        } else {
            None
        }
    })
}

fn scan_roots(
    app: &AppHandle,
    roots: Vec<PathBuf>,
    saved: HashSet<String>,
    cancel: Arc<AtomicBool>,
) {
    let mut seen_repos = HashSet::new();
    let mut visited_dirs = HashSet::new();
    let mut found = 0usize;

    let _ = app.emit("repo-discovery-started", ());

    for root in roots {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        let Some(root) = resolve_scan_dir(&root) else {
            continue;
        };
        if !visited_dirs.insert(root.clone()) {
            continue;
        }

        let mut stack = vec![(root, 0usize)];

        while let Some((dir, depth)) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            if dir.join(".git").exists() {
                if let Some(repo) = quick_repo_entry(&dir) {
                    if !saved.contains(&repo.path) && seen_repos.insert(repo.path.clone()) {
                        found += 1;
                        let _ = app.emit(
                            "repo-discovery-found",
                            DiscoveredRepoEntry {
                                id: repo.id,
                                name: repo.name,
                                path: repo.path,
                                last_edited_at: repo_last_edited_at(&dir),
                            },
                        );
                    }
                }
                continue;
            }

            if depth >= MAX_DEPTH {
                continue;
            }

            let entries = match fs::read_dir(&dir) {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(_) => continue,
                };

                if !file_type.is_dir() {
                    continue;
                }

                let child = entry.path();
                let child = if file_type.is_symlink() {
                    match fs::read_link(&child) {
                        Ok(link) if link.is_absolute() => link,
                        Ok(link) => dir.join(link),
                        Err(_) => continue,
                    }
                } else {
                    child
                };

                let Some(child) = resolve_scan_dir(&child) else {
                    continue;
                };
                if !visited_dirs.insert(child.clone()) {
                    continue;
                }

                let name = child
                    .file_name()
                    .and_then(|part| part.to_str())
                    .unwrap_or("");
                if name.starts_with('.') || should_skip_dir(name) {
                    continue;
                }

                stack.push((child, depth + 1));
            }
        }
    }

    let _ = app.emit("repo-discovery-finished", found);
}

#[tauri::command]
pub fn start_repo_discovery(app: AppHandle, saved_paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<RepoDiscovery>();
    let cancel = Arc::new(AtomicBool::new(false));

    if let Ok(mut current) = state.cancel.lock() {
        if let Some(previous) = current.take() {
            previous.store(true, Ordering::Relaxed);
        }
        *current = Some(cancel.clone());
    }

    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory.".to_string())?;
    let saved: HashSet<String> = saved_paths.into_iter().collect();
    let roots = discovery_roots(&home, &saved.iter().cloned().collect::<Vec<_>>());

    thread::spawn(move || {
        scan_roots(&app, roots, saved, cancel);
    });

    Ok(())
}
