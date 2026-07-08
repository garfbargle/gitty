use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// A launchable editor/app the user can open a repository in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorInfo {
    /// Stable identifier persisted in the frontend (e.g. "vscode").
    pub id: String,
    /// Human label shown in the chooser (e.g. "VS Code").
    pub name: String,
    /// Absolute path to the resolved `.app` bundle, or empty for the
    /// built-in "default"/"finder" targets that don't map to a bundle.
    pub app_path: String,
}

struct Candidate {
    id: &'static str,
    name: &'static str,
    /// Candidate `.app` bundle basenames to probe on disk.
    bundles: &'static [&'static str],
}

const CANDIDATES: &[Candidate] = &[
    Candidate { id: "vscode", name: "VS Code", bundles: &["Visual Studio Code.app"] },
    Candidate { id: "cursor", name: "Cursor", bundles: &["Cursor.app"] },
    Candidate { id: "zed", name: "Zed", bundles: &["Zed.app"] },
    Candidate { id: "windsurf", name: "Windsurf", bundles: &["Windsurf.app"] },
    Candidate { id: "sublime", name: "Sublime Text", bundles: &["Sublime Text.app"] },
    Candidate { id: "antigravity", name: "Antigravity", bundles: &["Antigravity.app"] },
    Candidate { id: "antigravity-ide", name: "Antigravity IDE", bundles: &["Antigravity IDE.app"] },
    Candidate { id: "xcode", name: "Xcode", bundles: &["Xcode.app"] },
];

/// Directories searched for application bundles, in priority order.
fn app_search_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join("Applications"));
    }
    dirs
}

/// Resolve a candidate to the first matching bundle path on disk, if any.
fn resolve_bundle(bundles: &[&str]) -> Option<PathBuf> {
    let dirs = app_search_dirs();
    for bundle in bundles {
        for dir in &dirs {
            let path = dir.join(bundle);
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

/// Detect installed editors, resolved to their concrete bundle paths, plus
/// the always-available "System default" and "Finder" folder targets.
#[tauri::command]
pub fn detect_editors() -> Vec<EditorInfo> {
    let mut editors: Vec<EditorInfo> = CANDIDATES
        .iter()
        .filter_map(|c| {
            resolve_bundle(c.bundles).map(|path| EditorInfo {
                id: c.id.to_string(),
                name: c.name.to_string(),
                app_path: path.to_string_lossy().to_string(),
            })
        })
        .collect();

    editors.push(EditorInfo {
        id: "default".to_string(),
        name: "System default app".to_string(),
        app_path: String::new(),
    });
    editors.push(EditorInfo {
        id: "finder".to_string(),
        name: "Finder".to_string(),
        app_path: String::new(),
    });

    editors
}

/// Open `path` in the given target. `target_id` selects the launch mode:
/// - "default": open with the OS default handler (`open <path>`)
/// - "finder": open the folder in Finder (`open -a Finder <path>`)
/// - otherwise `app_path` must be the absolute `.app` bundle to launch.
#[tauri::command]
pub fn open_in_editor(target_id: String, app_path: String, path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("No path to open".into());
    }
    if !Path::new(&path).exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let mut command = Command::new("open");
    match target_id.as_str() {
        "default" => {}
        "finder" => {
            command.arg("-a").arg("Finder");
        }
        _ => {
            if app_path.is_empty() {
                return Err("No application path provided".into());
            }
            command.arg("-a").arg(&app_path);
        }
    }
    command.arg(&path);

    let status = command
        .status()
        .map_err(|err| format!("Failed to open {path}: {err}"))?;

    if !status.success() {
        return Err(format!("Could not open {path}"));
    }
    Ok(())
}
