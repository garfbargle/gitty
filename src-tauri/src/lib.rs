mod discovery;
mod repo_icon;
mod settings;
mod summarize;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use discovery::{start_repo_discovery, RepoDiscovery};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
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
struct TagEntry {
    name: String,
    date: String,
    short_hash: String,
    unpushed: bool,
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
    ahead_commits: Vec<CommitEntry>,
    ahead_branch: Option<String>,
    remotes: Vec<RemoteEntry>,
    branches: Vec<BranchEntry>,
    tags: Vec<TagEntry>,
    unpushed_tags: Vec<String>,
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

fn is_detached_branch(branch: &str) -> bool {
    branch.contains("detached") || branch == "no commits"
}

fn upstream(repo_path: &Path) -> Option<String> {
    git(
        repo_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .ok()
    .filter(|name| !name.is_empty())
}

fn default_remote_name(repo_path: &Path) -> Option<String> {
    let output = git(repo_path, &["remote"]).ok()?;
    output
        .lines()
        .find(|name| *name == "origin")
        .or_else(|| output.lines().next())
        .map(str::to_string)
        .filter(|name| !name.is_empty())
}

fn parse_ahead_behind(output: &str) -> (u32, u32) {
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

fn validate_tag_name(name: &str) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Tag name is required.".to_string());
    }
    if name.starts_with('-') || name.contains("..") || name.ends_with('.') || name.ends_with('/') {
        return Err("Invalid tag name.".to_string());
    }
    if name.contains(' ') {
        return Err("Tag names cannot contain spaces.".to_string());
    }
    Ok(name)
}

fn local_tags(repo_path: &Path) -> Vec<String> {
    let Ok(output) = git(repo_path, &["tag", "-l"]) else {
        return Vec::new();
    };
    output
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

fn unpushed_tags(repo_path: &Path) -> Vec<String> {
    let Some(remote) = default_remote_name(repo_path) else {
        return Vec::new();
    };

    local_tags(repo_path)
        .into_iter()
        .filter(|tag| {
            let local_ref = format!("refs/tags/{tag}");
            let Ok(local_hash) = git(repo_path, &["rev-parse", &local_ref]) else {
                return false;
            };
            let remote_ref = format!("refs/tags/{tag}");
            let remote_output = git(repo_path, &["ls-remote", &remote, &remote_ref]).unwrap_or_default();
            let remote_hash = remote_output.split_whitespace().next().unwrap_or("");
            remote_hash != local_hash
        })
        .collect()
}

fn tag_list(repo_path: &Path) -> Vec<TagEntry> {
    let unpushed: HashSet<String> = unpushed_tags(repo_path).into_iter().collect();
    let Ok(output) = git(
        repo_path,
        &[
            "for-each-ref",
            "refs/tags",
            "--sort=-creatordate",
            "--format=%(refname:short)\x1f%(creatordate:iso-strict)\x1f%(*objectname:short)\x1e",
        ],
    ) else {
        return Vec::new();
    };

    output
        .split('\x1e')
        .filter_map(|record| {
            let record = record.trim();
            if record.is_empty() {
                return None;
            }

            let mut parts = record.split('\x1f');
            let name = parts.next()?.to_string();
            let date = parts.next().unwrap_or_default().to_string();
            let short_hash = parts.next().unwrap_or_default().to_string();
            Some(TagEntry {
                name: name.clone(),
                date,
                short_hash,
                unpushed: unpushed.contains(&name),
            })
        })
        .collect()
}

fn unpushed_without_tracking(repo_path: &Path) -> (u32, u32) {
    let ahead = git(
        repo_path,
        &["rev-list", "--count", "HEAD", "--not", "--remotes"],
    )
    .ok()
    .and_then(|value| value.parse().ok())
    .unwrap_or(0);
    (ahead, 0)
}

fn ahead_behind(repo_path: &Path, branch: &str, upstream: &Option<String>) -> (u32, u32) {
    if upstream.is_some() {
        let Ok(output) = git(
            repo_path,
            &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
        ) else {
            return unpushed_without_tracking(repo_path);
        };
        return parse_ahead_behind(&output);
    }

    if !is_detached_branch(branch) {
        if let Some(remote) = default_remote_name(repo_path) {
            let remote_ref = format!("{remote}/{branch}");
            if git(repo_path, &["rev-parse", "--verify", &remote_ref])
                .is_ok()
            {
                let Ok(output) = git(
                    repo_path,
                    &[
                        "rev-list",
                        "--left-right",
                        "--count",
                        &format!("HEAD...{remote_ref}"),
                    ],
                ) else {
                    return unpushed_without_tracking(repo_path);
                };
                return parse_ahead_behind(&output);
            }
        }
    }

    unpushed_without_tracking(repo_path)
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

            let status = line.get(0..2)?.to_string();
            let raw_path = line.get(3..)?.trim().to_string();
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

const COMMIT_LOG_PRETTY: &str = "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%D%x1f%s%x1e";

fn parse_commit_log_output(output: &str) -> Vec<CommitEntry> {
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

fn commit_log_with_args(repo_path: &Path, extra_args: &[&str]) -> Vec<CommitEntry> {
    let mut args = vec![
        "log",
        "--date=iso-strict",
        "--decorate=short",
        COMMIT_LOG_PRETTY,
    ];
    args.extend(extra_args);
    let Ok(output) = git(repo_path, &args) else {
        return Vec::new();
    };
    parse_commit_log_output(&output)
}

fn commit_log(repo_path: &Path, limit: u32) -> Vec<CommitEntry> {
    let limit = limit.clamp(25, 400).to_string();
    commit_log_with_args(repo_path, &["-n", &limit])
}

fn is_ancestor(repo_path: &Path, ancestor: &str, descendant: &str) -> bool {
    git(
        repo_path,
        &["merge-base", "--is-ancestor", ancestor, descendant],
    )
    .is_ok()
}

fn branches_containing(repo_path: &Path, commit: &str) -> Vec<String> {
    git(
        repo_path,
        &["branch", "--contains", commit, "--format=%(refname:short)"],
    )
    .unwrap_or_default()
    .lines()
    .filter(|name| !name.is_empty())
    .map(str::to_string)
    .collect()
}

fn append_unique_commits(
    target: &mut Vec<CommitEntry>,
    seen: &mut HashSet<String>,
    commits: Vec<CommitEntry>,
) {
    for commit in commits {
        if seen.insert(commit.hash.clone()) {
            target.push(commit);
        }
    }
}

fn branch_ahead_commits(
    repo_path: &Path,
    head: &str,
    branch: &str,
    limit: u32,
) -> Vec<CommitEntry> {
    let Ok(tip) = git(repo_path, &["rev-parse", branch]) else {
        return Vec::new();
    };
    if tip == head || !is_ancestor(repo_path, head, &tip) {
        return Vec::new();
    }
    let range = format!("{head}..{tip}");
    let limit_str = limit.to_string();
    commit_log_with_args(repo_path, &[&range, "-n", &limit_str])
}

fn branch_descendant_commits_from_reflog(
    repo_path: &Path,
    head: &str,
    branch: &str,
    limit: u32,
    seen: &mut HashSet<String>,
) -> Vec<CommitEntry> {
    let limit_str = limit.to_string();
    let Ok(output) = git(
        repo_path,
        &[
            "reflog",
            "show",
            &format!("refs/heads/{branch}"),
            "--format=%H",
            "-n",
            &limit_str,
        ],
    ) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for hash in output.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if hash == head || !is_ancestor(repo_path, head, hash) {
            continue;
        }
        let range = format!("{head}..{hash}");
        let range_commits = commit_log_with_args(repo_path, &[&range, "-n", &limit_str]);
        append_unique_commits(&mut result, seen, range_commits);
    }
    result
}

fn ahead_commits(
    repo_path: &Path,
    head_commits: &[CommitEntry],
    limit: u32,
    current_branch: &str,
) -> (Vec<CommitEntry>, Option<String>) {
    let head = match git(repo_path, &["rev-parse", "HEAD"]) {
        Ok(hash) if !hash.is_empty() => hash,
        _ => return (Vec::new(), None),
    };

    let limit = limit.clamp(1, 400);
    let mut seen: HashSet<String> = head_commits.iter().map(|commit| commit.hash.clone()).collect();
    let mut collected = Vec::new();
    let mut resume_branch: Option<String> = None;
    let mut best_count = 0usize;

    let relevant_branches: Vec<String> = if current_branch.is_empty()
        || is_detached_branch(current_branch)
    {
        branches_containing(repo_path, &head)
    } else {
        vec![current_branch.to_string()]
    };

    for branch in &relevant_branches {
        let branch_commits = branch_ahead_commits(repo_path, &head, branch, limit);
        let count = branch_commits.len();
        if count > best_count {
            best_count = count;
            resume_branch = Some(branch.clone());
        }
        append_unique_commits(&mut collected, &mut seen, branch_commits);
    }

    // After a hard reset the branch tip matches HEAD, so branch_ahead_commits finds
    // nothing. Fall back to the branch reflog to surface commits that were left behind.
    if collected.is_empty() {
        for branch in &relevant_branches {
            let reflog_commits =
                branch_descendant_commits_from_reflog(repo_path, &head, branch, limit, &mut seen);
            let count = reflog_commits.len();
            if count > best_count {
                best_count = count;
                resume_branch = Some(branch.clone());
            }
            append_unique_commits(&mut collected, &mut seen, reflog_commits);
        }
    }

    collected.sort_by(|left, right| right.date.cmp(&left.date));
    collected.truncate(limit as usize);

    let resume = if collected.is_empty() {
        None
    } else {
        resume_branch.or_else(|| {
            if current_branch.is_empty() || is_detached_branch(current_branch) {
                None
            } else {
                Some(current_branch.to_string())
            }
        })
    };

    (collected, resume)
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
fn resolve_repo_icon(
    app: AppHandle,
    path: String,
    force_rescan: Option<bool>,
) -> Result<Option<String>, String> {
    let repo = normalize_repo(&path)?;
    repo_icon::resolve_repo_icon(&app, Path::new(&repo.path), force_rescan.unwrap_or(false))
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
        repos.push(repo.clone());
        repos.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        save_repos_to_disk(&app, &repos)?;
        repo_icon::warm_repo_icon_cache(&app, &repo.path)?;
    }

    Ok(repos)
}

#[tauri::command]
fn remove_repo(app: AppHandle, path: String) -> Result<Vec<RepoEntry>, String> {
    let mut repos = load_repos_from_disk(&app)?;
    repos.retain(|repo| repo.path != path);
    save_repos_to_disk(&app, &repos)?;
    repo_icon::clear_repo_icon_cache(&app, &path)?;
    Ok(repos)
}

fn repo_snapshot_blocking(path: String, limit: Option<u32>) -> Result<RepoSnapshot, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let log_limit = limit.unwrap_or(120);

    let branch = current_branch(&repo_path);
    let upstream = upstream(&repo_path);

    let repo_path_changes = repo_path.clone();
    let repo_path_commits = repo_path.clone();
    let repo_path_remotes = repo_path.clone();
    let repo_path_branches = repo_path.clone();

    let (changes, commits, remotes, branches) = std::thread::scope(|scope| {
        let changes_handle = scope.spawn(|| changed_files(&repo_path_changes));
        let commits_handle = scope.spawn(|| commit_log(&repo_path_commits, log_limit));
        let remotes_handle = scope.spawn(|| remote_list(&repo_path_remotes));
        let branches_handle = scope.spawn(|| branch_list(&repo_path_branches));
        (
            changes_handle.join().unwrap(),
            commits_handle.join().unwrap(),
            remotes_handle.join().unwrap(),
            branches_handle.join().unwrap(),
        )
    });

    let (ahead, behind) = ahead_behind(&repo_path, &branch, &upstream);
    let (ahead_commits, ahead_branch) =
        ahead_commits(&repo_path, &commits, log_limit, &branch);
    let unpushed_tags = unpushed_tags(&repo_path);
    let tags = tag_list(&repo_path);

    Ok(RepoSnapshot {
        repo,
        branch,
        upstream,
        ahead,
        behind,
        is_clean: changes.is_empty(),
        changes,
        commits,
        ahead_commits,
        ahead_branch,
        remotes,
        branches,
        tags,
        unpushed_tags,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoChanges {
    changes: Vec<FileChange>,
    is_clean: bool,
}

#[tauri::command]
fn repo_changes(path: String) -> Result<RepoChanges, String> {
    let repo = normalize_repo(&path)?;
    let changes = changed_files(Path::new(&repo.path));
    Ok(RepoChanges {
        is_clean: changes.is_empty(),
        changes,
    })
}

#[tauri::command]
async fn repo_snapshot(path: String, limit: Option<u32>) -> Result<RepoSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || repo_snapshot_blocking(path, limit))
        .await
        .map_err(|err| format!("Snapshot task failed: {err}"))?
}

fn commit_files(repo_path: &Path, commit: &str) -> Result<Vec<FileChange>, String> {
    let output = git_owned(
        repo_path,
        vec![
            "show".to_string(),
            "--name-status".to_string(),
            "--pretty=format:".to_string(),
            "--find-renames".to_string(),
            commit.to_string(),
        ],
    )?;

    Ok(output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }

            let mut parts = line.split('\t');
            let status_part = parts.next()?;
            let status_code = status_part.chars().next().unwrap_or('M');

            match status_code {
                'R' | 'C' => {
                    let old_path = parts.next().map(|value| value.to_string());
                    let path = parts.next()?.to_string();
                    Some(FileChange {
                        status: format!("{status_code} "),
                        path,
                        old_path,
                    })
                }
                _ => {
                    let path = parts.next()?.to_string();
                    Some(FileChange {
                        status: format!("{status_code} "),
                        path,
                        old_path: None,
                    })
                }
            }
        })
        .collect())
}

#[tauri::command]
fn commit_files_command(path: String, commit: String) -> Result<Vec<FileChange>, String> {
    let repo = normalize_repo(&path)?;
    commit_files(Path::new(&repo.path), &commit)
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileImagePreview {
    old_data_url: Option<String>,
    new_data_url: Option<String>,
}

fn image_mime_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("bmp") => "image/bmp",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}

fn is_image_path(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("svg")
            | Some("ico")
            | Some("bmp")
            | Some("avif")
    )
}

fn git_show_bytes(repo_path: &Path, spec: &str) -> Option<Vec<u8>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["show", spec])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;

    output.status.success().then_some(output.stdout)
}

fn read_working_tree_bytes(repo_path: &Path, file_path: &str) -> Option<Vec<u8>> {
    let full_path = repo_path.join(file_path);
    fs::read(full_path).ok()
}

fn untracked_file_diff(repo_path: &Path, file_path: &str) -> Result<Option<String>, String> {
    let full_path = repo_path.join(file_path);
    if !full_path.is_file() {
        return Ok(None);
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args([
            "--no-pager",
            "diff",
            "--no-index",
            "--color=never",
            "--",
            "/dev/null",
            file_path,
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|err| format!("Could not run git: {err}"))?;

    // git diff exits 1 when differences exist.
    let code = output.status.code();
    if code == Some(0) || code == Some(1) {
        let stdout = String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string();
        if !stdout.is_empty() {
            return Ok(Some(stdout));
        }
    }

    Ok(None)
}

fn bytes_to_data_url(bytes: &[u8], mime: &str) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

fn optional_data_url(bytes: Option<Vec<u8>>, mime: &str) -> Option<String> {
    bytes.map(|data| bytes_to_data_url(&data, mime))
}

#[tauri::command]
fn file_image_preview(
    path: String,
    file_path: String,
    commit: Option<String>,
    section: Option<String>,
) -> Result<FileImagePreview, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    if !is_image_path(&file_path) {
        return Err(format!("{file_path} is not a supported image file."));
    }

    let mime = image_mime_type(&file_path);

    if let Some(commit) = commit.filter(|value| !value.is_empty()) {
        let old = git_show_bytes(repo_path, &format!("{commit}^:{file_path}"));
        let new = git_show_bytes(repo_path, &format!("{commit}:{file_path}"));
        return Ok(FileImagePreview {
            old_data_url: optional_data_url(old, mime),
            new_data_url: optional_data_url(new, mime),
        });
    }

    let (old, new) = match section.as_deref() {
        Some("staged") => (
            git_show_bytes(repo_path, &format!("HEAD:{file_path}")),
            git_show_bytes(repo_path, &format!(":{file_path}")),
        ),
        Some("unstaged") => {
            let index = git_show_bytes(repo_path, &format!(":{file_path}"));
            let head = git_show_bytes(repo_path, &format!("HEAD:{file_path}"));
            (
                index.or(head),
                read_working_tree_bytes(repo_path, &file_path),
            )
        }
        _ => (
            git_show_bytes(repo_path, &format!("HEAD:{file_path}")),
            read_working_tree_bytes(repo_path, &file_path)
                .or_else(|| git_show_bytes(repo_path, &format!(":{file_path}"))),
        ),
    };

    Ok(FileImagePreview {
        old_data_url: optional_data_url(old, mime),
        new_data_url: optional_data_url(new, mime),
    })
}

fn file_diff_blocking(path: String, file_path: String, commit: Option<String>) -> Result<String, String> {
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
        if let Some(untracked) = untracked_file_diff(repo_path, &file_path)? {
            return Ok(untracked);
        }
        Ok(format!(
            "No tracked diff for {file_path}. This may be an untracked file."
        ))
    } else {
        Ok(combined)
    }
}

#[tauri::command]
async fn file_diff(path: String, file_path: String, commit: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || file_diff_blocking(path, file_path, commit))
        .await
        .map_err(|err| format!("Diff task failed: {err}"))?
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
fn head_commit_message(path: String) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    let Ok(message) = git(Path::new(&repo.path), &["log", "-1", "--format=%B"]) else {
        return Ok(String::new());
    };
    Ok(message.trim_end().to_string())
}

#[tauri::command]
fn commit_message(path: String, commit: String) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    let message = git(
        Path::new(&repo.path),
        &["log", "-1", "--format=%B", commit.trim()],
    )?;
    Ok(message.trim_end().to_string())
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

fn push_tags(repo_path: &Path, remote: &str, tags: &[String]) -> Result<String, String> {
    if tags.is_empty() {
        return Ok(String::new());
    }

    let mut args = vec!["push".to_string(), remote.to_string()];
    args.extend(tags.iter().cloned());
    git_owned(repo_path, args)
}

fn push_repo_blocking(path: String, force: bool) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let branch = current_branch(repo_path);
    let tags_to_push = unpushed_tags(repo_path);
    let remote = default_remote_name(repo_path);
    let mut outputs = Vec::new();
    let (ahead, behind) = ahead_behind(repo_path, &branch, &upstream(repo_path));
    let branch_pushed = ahead > 0 || (force && behind > 0);

    if branch_pushed {
        let mut args = vec!["push".to_string()];
        if force {
            args.push("--force-with-lease".to_string());
        }

        if upstream(repo_path).is_none() {
            if !is_detached_branch(&branch) {
                if let Some(remote_name) = remote.as_deref() {
                    args.push("-u".to_string());
                    args.push(remote_name.to_string());
                    args.push(branch.clone());
                }
            }
        }

        outputs.push(git_owned(repo_path, args)?);
    }

    if !tags_to_push.is_empty() {
        let remote_name = remote
            .as_deref()
            .ok_or_else(|| "Add a remote before pushing tags.".to_string())?;
        outputs.push(push_tags(repo_path, remote_name, &tags_to_push)?);
    }

    if outputs.is_empty() {
        return Err("Nothing to push.".to_string());
    }

    let tag_count = tags_to_push.len();
    let message = match (branch_pushed, tag_count) {
        (true, 0) if force => "Force push completed with --force-with-lease.".to_string(),
        (true, 0) => "Push completed.".to_string(),
        (true, 1) => "Push completed (1 tag pushed).".to_string(),
        (true, count) => format!("Push completed ({count} tags pushed)."),
        (false, 1) => "Pushed 1 tag.".to_string(),
        (false, count) => format!("Pushed {count} tags."),
    };

    Ok(ActionResult {
        message,
        output: outputs.join("\n\n"),
    })
}

#[tauri::command]
async fn push_repo(path: String, force: bool) -> Result<ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || push_repo_blocking(path, force))
        .await
        .map_err(|err| format!("Push task failed: {err}"))?
}

#[tauri::command]
fn create_tag(path: String, name: String, commit: Option<String>) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let name = validate_tag_name(&name)?;
    let mut args = vec!["tag".to_string(), name.clone()];
    if let Some(commit) = commit.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        args.push(commit);
    }
    let output = git_owned(repo_path, args)?;
    Ok(ActionResult {
        message: format!("Created tag {name}."),
        output,
    })
}

#[tauri::command]
fn delete_tag(path: String, name: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let name = validate_tag_name(&name)?;
    let output = git(repo_path, &["tag", "-d", &name])?;
    Ok(ActionResult {
        message: format!("Deleted tag {name}."),
        output,
    })
}

#[tauri::command]
fn reset_working_tree(path: String, include_untracked: bool) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let mut outputs = Vec::new();

    outputs.push(git(repo_path, &["reset", "--hard", "HEAD"])?);

    if include_untracked {
        outputs.push(git(repo_path, &["clean", "-fd"])?);
    }

    Ok(ActionResult {
        message: if include_untracked {
            "All working tree changes discarded and untracked files removed.".to_string()
        } else {
            "All tracked changes discarded.".to_string()
        },
        output: outputs.join("\n\n"),
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

#[tauri::command]
fn get_app_settings(app: AppHandle) -> Result<settings::AppSettingsView, String> {
    settings::settings_view(&app)
}

#[tauri::command]
fn set_auto_summarize_enabled(app: AppHandle, enabled: bool) -> Result<settings::AppSettingsView, String> {
    let mut current = settings::load_settings(&app)?;
    current.auto_summarize_enabled = enabled;
    settings::save_settings(&app, &current)?;
    settings::settings_view(&app)
}

#[tauri::command]
fn set_nvidia_api_key(app: AppHandle, api_key: String) -> Result<settings::AppSettingsView, String> {
    let mut current = settings::load_settings(&app)?;
    let normalized = settings::normalize_nvidia_api_key(&api_key);
    if normalized.is_empty() {
        return Err("API key is required.".to_string());
    }

    summarize::verify_nvidia_api_key(&normalized)?;
    current.nvidia_api_key = Some(normalized);
    settings::save_settings(&app, &current)?;
    settings::settings_view(&app)
}

#[tauri::command]
fn delete_nvidia_api_key(app: AppHandle) -> Result<settings::AppSettingsView, String> {
    let mut current = settings::load_settings(&app)?;
    current.nvidia_api_key = None;
    settings::save_settings(&app, &current)?;
    settings::settings_view(&app)
}

#[tauri::command]
fn test_nvidia_api_key(app: AppHandle, api_key: Option<String>) -> Result<ActionResult, String> {
    let key = match api_key.as_deref() {
        Some(value) if !settings::normalize_nvidia_api_key(value).is_empty() => {
            settings::normalize_nvidia_api_key(value)
        }
        _ => settings::nvidia_api_key(&app)?,
    };

    summarize::verify_nvidia_api_key(&key)?;
    Ok(ActionResult {
        message: "NVIDIA API key is valid.".to_string(),
        output: String::new(),
    })
}

#[tauri::command]
async fn summarize_changes(
    app: AppHandle,
    path: String,
    scope: Option<String>,
) -> Result<summarize::ChangeSummary, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = repo.path;
    let parsed_scope = summarize::parse_summarize_scope(scope.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        summarize::summarize_changes(&app, Path::new(&repo_path), parsed_scope)
    })
    .await
    .map_err(|err| format!("Summarize task failed: {err}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RepoDiscovery::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            init_repo,
            list_repos,
            resolve_repo_icon,
            add_repo,
            remove_repo,
            start_repo_discovery,
            repo_snapshot,
            repo_changes,
            commit_files_command,
            commit_diff,
            file_diff,
            file_image_preview,
            checkout_branch,
            merge_branch,
            stage_files,
            stage_all,
            commit_repo,
            head_commit_message,
            commit_message,
            fetch_repo,
            remove_remote,
            push_repo,
            create_tag,
            delete_tag,
            reset_working_tree,
            reset_to_commit,
            set_remote,
            get_app_settings,
            set_auto_summarize_enabled,
            set_nvidia_api_key,
            delete_nvidia_api_key,
            test_nvidia_api_key,
            summarize_changes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
