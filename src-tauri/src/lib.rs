use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoEntry {
    id: String,
    name: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitEntry {
    hash: String,
    short_hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    refs: String,
    subject: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChange {
    status: String,
    path: String,
    old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteEntry {
    name: String,
    url: String,
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BranchEntry {
    name: String,
    is_remote: bool,
    is_current: bool,
    upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoSnapshot {
    repo: RepoEntry,
    branch: String,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    is_clean: bool,
    changes: Vec<FileChange>,
    commits: Vec<CommitEntry>,
    remotes: Vec<RemoteEntry>,
    branches: Vec<BranchEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    message: String,
    output: String,
}

const REPOS_FILE: &str = "repos.json";

fn repos_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not locate app config directory: {err}"))?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Could not create config directory {}: {err}", dir.display()))?;
    Ok(dir.join(REPOS_FILE))
}

fn load_repos_from_disk(app: &AppHandle) -> Result<Vec<RepoEntry>, String> {
    let path = repos_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(&path)
        .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
    serde_json::from_str(&data).map_err(|err| format!("Could not parse {}: {err}", path.display()))
}

fn save_repos_to_disk(app: &AppHandle, repos: &[RepoEntry]) -> Result<(), String> {
    let path = repos_file(app)?;
    let data = serde_json::to_string_pretty(repos)
        .map_err(|err| format!("Could not serialize repo list: {err}"))?;
    fs::write(&path, data).map_err(|err| format!("Could not write {}: {err}", path.display()))
}

fn git(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    git_owned(
        repo_path,
        args.iter().map(|arg| (*arg).to_string()).collect(),
    )
}

fn git_owned(repo_path: &Path, args: Vec<String>) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|err| format!("Could not run git: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    let stderr = String::from_utf8_lossy(&output.stderr)
        .trim_end()
        .to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let command = format!("git -C {} {}", repo_path.display(), args.join(" "));
        let detail = [stderr, stdout]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Err(format!("{command}\n{detail}"))
    }
}

fn normalize_repo(path: &str) -> Result<RepoEntry, String> {
    let repo_path = PathBuf::from(path);
    if !repo_path.exists() {
        return Err(format!("{path} does not exist"));
    }

    let root = git(&repo_path, &["rev-parse", "--show-toplevel"])?;
    let root_path = PathBuf::from(root);
    let canonical = fs::canonicalize(&root_path)
        .map_err(|err| format!("Could not resolve {}: {err}", root_path.display()))?;
    let name = canonical
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("Repository")
        .to_string();
    let path = canonical.to_string_lossy().to_string();

    Ok(RepoEntry {
        id: path.clone(),
        name,
        path,
    })
}

fn current_branch(repo_path: &Path) -> String {
    git(repo_path, &["branch", "--show-current"])
        .ok()
        .filter(|branch| !branch.is_empty())
        .unwrap_or_else(|| {
            git(repo_path, &["rev-parse", "--short", "HEAD"])
                .map(|hash| format!("detached @ {hash}"))
                .unwrap_or_else(|_| "no commits".to_string())
        })
}

fn upstream(repo_path: &Path) -> Option<String> {
    git(
        repo_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .ok()
    .filter(|name| !name.is_empty())
}

fn ahead_behind(repo_path: &Path, has_upstream: bool) -> (u32, u32) {
    if !has_upstream {
        return (0, 0);
    }

    let Ok(output) = git(
        repo_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
    ) else {
        return (0, 0);
    };
    let mut parts = output.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn changed_files(repo_path: &Path) -> Vec<FileChange> {
    let Ok(output) = git(repo_path, &["status", "--porcelain=v1", "-uall"]) else {
        return Vec::new();
    };

    output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }

            let status = line[0..2].trim().to_string();
            let raw_path = line[3..].to_string();
            let (path, old_path) = raw_path
                .split_once(" -> ")
                .map(|(old_path, path)| (path.to_string(), Some(old_path.to_string())))
                .unwrap_or((raw_path, None));

            Some(FileChange {
                status,
                path,
                old_path,
            })
        })
        .collect()
}

fn commit_log(repo_path: &Path, limit: u32) -> Vec<CommitEntry> {
    let limit = limit.clamp(25, 400).to_string();
    let Ok(output) = git(
        repo_path,
        &[
            "log",
            "--date=iso-strict",
            "--decorate=short",
            "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%D%x1f%s%x1e",
            "-n",
            &limit,
        ],
    ) else {
        return Vec::new();
    };

    output
        .split('\x1e')
        .filter_map(|record| {
            let record = record.trim_matches('\n');
            if record.is_empty() {
                return None;
            }

            let mut parts = record.split('\x1f');
            Some(CommitEntry {
                hash: parts.next()?.to_string(),
                short_hash: parts.next()?.to_string(),
                parents: parts
                    .next()
                    .unwrap_or_default()
                    .split_whitespace()
                    .map(|part| part.to_string())
                    .collect(),
                author: parts.next().unwrap_or_default().to_string(),
                date: parts.next().unwrap_or_default().to_string(),
                refs: parts.next().unwrap_or_default().to_string(),
                subject: parts.next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

fn branch_list(repo_path: &Path) -> Vec<BranchEntry> {
    let current = git(repo_path, &["branch", "--show-current"]).unwrap_or_default();
    let Ok(output) = git(
        repo_path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "refs/heads/",
            "refs/remotes/",
            "--format=%(refname:short)\x1f%(upstream:short)\x1f%(refname)",
        ],
    ) else {
        return Vec::new();
    };

    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let name = parts.next()?.to_string();
            if name.is_empty() || name.ends_with("/HEAD") {
                return None;
            }
            let upstream = parts
                .next()
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());
            let full_ref = parts.next().unwrap_or_default();
            let is_remote = full_ref.starts_with("refs/remotes/");
            let is_current = !current.is_empty() && name == current;
            Some(BranchEntry {
                name,
                is_remote,
                is_current,
                upstream,
            })
        })
        .collect()
}

fn remote_list(repo_path: &Path) -> Vec<RemoteEntry> {
    let Ok(output) = git(repo_path, &["remote", "-v"]) else {
        return Vec::new();
    };

    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?.to_string();
            let url = parts.next()?.to_string();
            let kind = parts
                .next()
                .unwrap_or_default()
                .trim_matches('(')
                .trim_matches(')')
                .to_string();
            Some(RemoteEntry { name, url, kind })
        })
        .collect()
}

#[tauri::command]
fn list_repos(app: AppHandle) -> Result<Vec<RepoEntry>, String> {
    load_repos_from_disk(&app)
}

#[tauri::command]
fn add_repo(app: AppHandle, path: String) -> Result<Vec<RepoEntry>, String> {
    let repo = normalize_repo(&path)?;
    let mut repos = load_repos_from_disk(&app)?;

    if !repos.iter().any(|existing| existing.path == repo.path) {
        repos.push(repo);
        repos.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        save_repos_to_disk(&app, &repos)?;
    }

    Ok(repos)
}

#[tauri::command]
fn remove_repo(app: AppHandle, path: String) -> Result<Vec<RepoEntry>, String> {
    let mut repos = load_repos_from_disk(&app)?;
    repos.retain(|repo| repo.path != path);
    save_repos_to_disk(&app, &repos)?;
    Ok(repos)
}

#[tauri::command]
fn repo_snapshot(path: String, limit: Option<u32>) -> Result<RepoSnapshot, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let upstream = upstream(&repo_path);
    let (ahead, behind) = ahead_behind(&repo_path, upstream.is_some());
    let changes = changed_files(&repo_path);

    Ok(RepoSnapshot {
        repo,
        branch: current_branch(&repo_path),
        upstream,
        ahead,
        behind,
        is_clean: changes.is_empty(),
        changes,
        commits: commit_log(&repo_path, limit.unwrap_or(120)),
        remotes: remote_list(&repo_path),
        branches: branch_list(&repo_path),
    })
}

#[tauri::command]
fn commit_diff(path: String, commit: String) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    git_owned(
        Path::new(&repo.path),
        vec![
            "--no-pager".to_string(),
            "show".to_string(),
            "--stat".to_string(),
            "--patch".to_string(),
            "--find-renames".to_string(),
            "--find-copies".to_string(),
            "--color=never".to_string(),
            commit,
        ],
    )
}

#[tauri::command]
fn file_diff(path: String, file_path: String, commit: Option<String>) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    if let Some(commit) = commit {
        return git_owned(
            repo_path,
            vec![
                "--no-pager".to_string(),
                "show".to_string(),
                "--format=".to_string(),
                "--patch".to_string(),
                "--color=never".to_string(),
                commit,
                "--".to_string(),
                file_path,
            ],
        );
    }

    let unstaged = git_owned(
        repo_path,
        vec![
            "--no-pager".to_string(),
            "diff".to_string(),
            "--color=never".to_string(),
            "--".to_string(),
            file_path.clone(),
        ],
    )?;
    let staged = git_owned(
        repo_path,
        vec![
            "--no-pager".to_string(),
            "diff".to_string(),
            "--cached".to_string(),
            "--color=never".to_string(),
            "--".to_string(),
            file_path.clone(),
        ],
    )?;

    let combined = [staged, unstaged]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    if combined.is_empty() {
        Ok(format!(
            "No tracked diff for {file_path}. This may be an untracked file."
        ))
    } else {
        Ok(combined)
    }
}

#[tauri::command]
fn checkout_branch(path: String, branch: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("Branch name is required.".to_string());
    }
    let repo_path = Path::new(&repo.path);
    let output = if branch.contains('/') {
        git(repo_path, &["switch", "--track", &branch]).or_else(|_| {
            git(repo_path, &["checkout", "--track", &branch])
                .or_else(|_| git(repo_path, &["checkout", &branch]))
        })?
    } else {
        git(repo_path, &["switch", &branch])
            .or_else(|_| git(repo_path, &["checkout", &branch]))?
    };

    Ok(ActionResult {
        message: format!("Checked out {branch}."),
        output,
    })
}

#[tauri::command]
fn merge_branch(path: String, branch: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("Branch name is required.".to_string());
    }
    let output = git(Path::new(&repo.path), &["merge", &branch])?;
    Ok(ActionResult {
        message: format!("Merged {branch}."),
        output,
    })
}

#[tauri::command]
fn stage_files(path: String, files: Vec<String>, stage: bool) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    if files.is_empty() {
        return Err("Select at least one file.".to_string());
    }

    let mut args = if stage {
        vec!["add".to_string(), "--".to_string()]
    } else {
        vec!["restore".to_string(), "--staged".to_string(), "--".to_string()]
    };
    args.extend(files.iter().cloned());
    let output = git_owned(repo_path, args)?;

    Ok(ActionResult {
        message: if stage {
            "Files staged.".to_string()
        } else {
            "Files unstaged.".to_string()
        },
        output,
    })
}

#[tauri::command]
fn stage_all(path: String, stage: bool) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let output = if stage {
        git(repo_path, &["add", "-A"])?
    } else {
        git(repo_path, &["restore", "--staged", "."])?
    };

    Ok(ActionResult {
        message: if stage {
            "All changes staged.".to_string()
        } else {
            "All changes unstaged.".to_string()
        },
        output,
    })
}

#[tauri::command]
fn commit_repo(path: String, message: String, amend: Option<bool>) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("Commit message is required.".to_string());
    }
    let mut args = vec!["commit".to_string(), "-m".to_string(), message.clone()];
    if amend.unwrap_or(false) {
        args.push("--amend".to_string());
    }
    let output = git_owned(Path::new(&repo.path), args)?;
    Ok(ActionResult {
        message: if amend.unwrap_or(false) {
            format!("Amended commit: {message}")
        } else {
            format!("Committed: {message}")
        },
        output,
    })
}

#[tauri::command]
fn init_repo(app: AppHandle, path: String) -> Result<Vec<RepoEntry>, String> {
    let path_buf = PathBuf::from(path.trim());
    if path_buf.as_os_str().is_empty() {
        return Err("Repository path is required.".to_string());
    }
    if !path_buf.exists() {
        fs::create_dir_all(&path_buf)
            .map_err(|err| format!("Could not create {}: {err}", path_buf.display()))?;
    }
    git(&path_buf, &["init"])?;
    add_repo(app, path_buf.to_string_lossy().to_string())
}

#[tauri::command]
fn fetch_repo(path: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let output = git(Path::new(&repo.path), &["fetch", "--all", "--prune"])?;
    Ok(ActionResult {
        message: "Fetch completed.".to_string(),
        output,
    })
}

#[tauri::command]
fn remove_remote(path: String, name: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Remote name is required.".to_string());
    }
    let output = git(Path::new(&repo.path), &["remote", "remove", &name])?;
    Ok(ActionResult {
        message: format!("Remote {name} removed."),
        output,
    })
}

#[tauri::command]
fn push_repo(path: String, force: bool) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let args = if force {
        vec!["push", "--force-with-lease"]
    } else {
        vec!["push"]
    };
    let output = git(Path::new(&repo.path), &args)?;

    Ok(ActionResult {
        message: if force {
            "Force push completed with --force-with-lease.".to_string()
        } else {
            "Push completed.".to_string()
        },
        output,
    })
}

#[tauri::command]
fn reset_to_commit(path: String, commit: String, mode: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let reset_flag = match mode.as_str() {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => return Err("Reset mode must be soft or hard.".to_string()),
    };
    let output = git_owned(
        Path::new(&repo.path),
        vec!["reset".to_string(), reset_flag.to_string(), commit.clone()],
    )?;

    Ok(ActionResult {
        message: format!("{mode} reset to {commit} completed."),
        output,
    })
}

#[tauri::command]
fn set_remote(path: String, name: String, url: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let name = name.trim().to_string();
    let url = url.trim().to_string();

    if name.is_empty() || url.is_empty() {
        return Err("Remote name and URL are required.".to_string());
    }

    let existing = git(repo_path, &["remote"]).unwrap_or_default();
    let args = if existing.lines().any(|remote| remote == name) {
        vec![
            "remote".to_string(),
            "set-url".to_string(),
            name.clone(),
            url,
        ]
    } else {
        vec!["remote".to_string(), "add".to_string(), name.clone(), url]
    };
    let output = git_owned(repo_path, args)?;

    Ok(ActionResult {
        message: format!("Remote {name} saved."),
        output,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            init_repo,
            list_repos,
            add_repo,
            remove_repo,
            repo_snapshot,
            commit_diff,
            file_diff,
            checkout_branch,
            merge_branch,
            stage_files,
            stage_all,
            commit_repo,
            fetch_repo,
            remove_remote,
            push_repo,
            reset_to_commit,
            set_remote
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
