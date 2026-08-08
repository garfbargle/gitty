mod discovery;
mod editors;
mod repo_icon;
mod runner;
mod settings;
mod summarize;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use discovery::{start_repo_discovery, RepoDiscovery};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

static SNAPSHOT_GENERATION: AtomicU64 = AtomicU64::new(0);
const SNAPSHOT_SUPERSEDED: &str = "__superseded__";
const NETWORK_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const GIT_PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);

fn network_operation_is_idle(elapsed: Duration, last_activity_ms: u64) -> bool {
    elapsed
        .as_millis()
        .saturating_sub(last_activity_ms as u128)
        >= NETWORK_IDLE_TIMEOUT.as_millis()
}
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    id: String,
    name: String,
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    has_uncommitted_changes: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_activity_at: Option<u64>,
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
    /// Tip commit of the branch, so the UI can locate it on the graph.
    tip_hash: Option<String>,
    tip_short_hash: Option<String>,
    /// Committer date of the tip (iso-strict), for "recently active" sorting.
    last_commit_date: Option<String>,
    /// How this branch sits relative to the *current* branch: `ahead` is commits
    /// this branch has that the current branch lacks (pull candidates), `behind`
    /// is commits the current branch has that this branch lacks.
    ahead: Option<u32>,
    behind: Option<u32>,
    /// How this branch sits relative to its own upstream.
    ahead_upstream: Option<u32>,
    behind_upstream: Option<u32>,
}

/// How the checked-out branch sits relative to one reference branch (the trunk,
/// or this branch's own upstream), with the reference's divergent commits so the
/// timeline can draw a "context lane" showing exactly how far behind you are.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BranchDivergence {
    /// Display name of the reference (e.g. "main" or "origin/feature").
    ref_name: String,
    /// "integration" (the trunk you ship into) or "upstream" (this branch's remote).
    kind: String,
    /// Where HEAD and the reference last shared history. The lane forks here.
    merge_base: Option<String>,
    /// Commits the reference has that HEAD lacks — how far behind you are.
    behind: u32,
    /// Commits HEAD has that the reference lacks — how far ahead you are.
    ahead: u32,
    /// The reference's divergent commits since the merge-base, newest first and
    /// capped. These render as the lane's ghost nodes.
    commits: Vec<CommitEntry>,
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
    /// Linear HEAD ancestry — drives the working-tree timeline and picker.
    commits: Vec<CommitEntry>,
    /// Multi-branch history for the graph view; shows parallel lanes.
    graph_commits: Vec<CommitEntry>,
    ahead_commits: Vec<CommitEntry>,
    ahead_branch: Option<String>,
    remotes: Vec<RemoteEntry>,
    branches: Vec<BranchEntry>,
    /// How the checked-out branch sits relative to the trunk and its own upstream,
    /// for the working-tree timeline's branch-context lanes.
    timeline_context: Vec<BranchDivergence>,
    /// The most recently active *other* branch, when it's newer than the trunk —
    /// the single sibling lane the timeline draws.
    #[serde(skip_serializing_if = "Option::is_none")]
    sibling_tip: Option<SiblingTip>,
    tags: Vec<TagEntry>,
    unpushed_tags: Vec<String>,
    /// Which commits on HEAD the remote does not have, newest first, so the
    /// timeline can draw the push boundary instead of leaving the count in the
    /// push button as the only word on the subject.
    unpushed_commits: Vec<String>,
    /// The current branch exists locally but not on any remote, so pushing it
    /// would publish it. Lights the push button even with no commits ahead.
    branch_unpublished: bool,
    /// A previous primary push succeeded but at least one backup copy failed.
    /// Keep Push enabled so the user can repair the backup without creating a
    /// throwaway commit first.
    backup_push_pending: bool,
    /// Whether this repository should copy a successful primary push to its
    /// configured backup remotes. Backup setup enables this by default; users
    /// can change it later in repository settings.
    backup_on_push: bool,
    /// When the remote was last actually reached, as milliseconds since the
    /// epoch, or `None` if it never has been.
    ///
    /// Everything the interface says about the remote (in sync, ahead, behind,
    /// the ghost lane) is only as true as the last successful fetch, and until
    /// now those claims were stated flat. A repository that has never been
    /// fetched, or whose fetches have been failing quietly, looked exactly like
    /// one checked a second ago. This lets the interface age its own claims
    /// instead of asserting them.
    #[serde(skip_serializing_if = "Option::is_none")]
    last_fetched_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    message: String,
    output: String,
}

/// A line (or progress fragment) emitted while a network Git operation runs.
/// The frontend streams these into the status console instead of waiting for
/// the command to exit before explaining what it is doing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitProgress {
    path: String,
    phase: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSetupResult {
    message: String,
    output: String,
    synced: bool,
}

/// A safety preview of merging `source` into `target`, computed without
/// touching the working tree.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeAnalysis {
    source: String,
    target: String,
    /// Commits in `source` that `target` does not yet contain.
    commits: Vec<CommitEntry>,
    /// Files that the merge would change.
    files: Vec<FileChange>,
    conflict_files: Vec<String>,
    has_conflicts: bool,
    /// Whether conflict prediction was able to run at all.
    conflicts_known: bool,
    working_tree_clean: bool,
    /// How far `target` trails its own upstream (needs update first).
    target_behind: u32,
    target_has_upstream: bool,
    /// `source` has nothing `target` is missing.
    already_up_to_date: bool,
    /// Commits `target` has that `source` lacks — i.e. how far behind the base
    /// the source branch is. Non-zero means "update your branch first".
    source_behind: u32,
    /// `target` can be fast-forwarded to `source` (no merge commit needed).
    fast_forward: bool,
    source_is_current: bool,
    target_is_current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeOutcome {
    /// "merged" | "fast_forward" | "conflicts" | "up_to_date"
    status: String,
    conflict_files: Vec<String>,
    message: String,
    output: String,
    /// When the merge ran inside a linked worktree (merge-into-trunk), the path
    /// to that worktree. Conflict resolution and completion target this path so
    /// the user's own checkout is never touched. `None` for in-place merges.
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree: Option<String>,
}

/// Outcome of updating the current branch by rebasing it onto another ref.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateOutcome {
    /// "updated" | "conflicts" | "up_to_date"
    status: String,
    conflict_files: Vec<String>,
    message: String,
    output: String,
}

/// Whether a rebase (branch update) is mid-flight, so the UI can resume it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    rebasing: bool,
    conflict_files: Vec<String>,
    /// Files that were conflicted but are now staged/resolved.
    resolved_files: Vec<String>,
}

/// One entry in a repo's committed linked-folder manifest
/// (`.gitty/subtrees.json`). History is the source of truth for *which* folders
/// are subtrees; this file only supplies the origin URL/branch that history
/// doesn't record, so Update can be one click.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubtreeManifestEntry {
    folder: String,
    url: String,
    branch: String,
}

/// A folder in this repo that mirrors another repo (a git subtree), surfaced to
/// the UI as a "linked folder".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkedFolder {
    /// The folder inside the repo, e.g. "vendor/ui-kit".
    prefix: String,
    /// Source repo URL. Empty when recovered from history without a manifest hint.
    url: String,
    /// Source ref/branch. Empty when unknown (see `url`).
    branch: String,
    /// Short SHA of the source commit last pulled in, from the squash trailer.
    last_synced_short: Option<String>,
    /// Whether the folder has uncommitted local edits.
    dirty: bool,
    /// Whether Gitty knows this folder's origin (a manifest entry exists). When
    /// false, the UI asks for the URL before the first Update.
    known_source: bool,
}

/// Whether a linked folder's source ref has moved past what's currently pulled
/// in — computed on demand (a network `ls-remote`), separate from the instant,
/// offline `list_linked_folders`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtreeUpdateStatus {
    prefix: String,
    /// `Some(true)` the source moved on (Update will pull), `Some(false)` in sync,
    /// `None` couldn't tell (offline, unknown source, or no recorded sync point).
    updates_available: Option<bool>,
}

/// Whether a linked folder has local content its source doesn't have yet — i.e.
/// there's something to Publish. Judged by comparing the folder's tree to the
/// source's last-fetched tip tree (content, not the split-SHA trailer, which
/// `git subtree push` leaves stale). Instant/local — no network.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtreePublishStatus {
    prefix: String,
    /// `Some(true)` the folder differs from its source tip (Publish has work),
    /// `Some(false)` identical, `None` couldn't tell (unknown source, or its
    /// remote hasn't been fetched so there's nothing local to compare against).
    publishable: Option<bool>,
}

/// The most recently active *other* branch — a single context lane for the
/// timeline. Chosen only when its tip is newer than the trunk's, so a stale
/// branch never clutters the view.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SiblingTip {
    name: String,
    tip: CommitEntry,
    /// Commits this branch has that HEAD lacks.
    ahead: u32,
    /// Commits HEAD has that this branch lacks.
    behind: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeStatus {
    merging: bool,
    branch: String,
    conflict_files: Vec<String>,
    /// Files that were conflicted but are now staged/resolved.
    resolved_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictSides {
    /// Content of the side we are merging into (the current branch, "ours").
    ours: String,
    /// Content of the branch being merged in ("theirs").
    theirs: String,
    /// Working-tree content, including conflict markers, that the user edits.
    result: String,
    ours_exists: bool,
    theirs_exists: bool,
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
    let persistent_repos = repos
        .iter()
        .map(|repo| RepoEntry {
            id: repo.id.clone(),
            name: repo.name.clone(),
            path: repo.path.clone(),
            has_uncommitted_changes: None,
            last_activity_at: None,
        })
        .collect::<Vec<_>>();
    let data = serde_json::to_string_pretty(&persistent_repos)
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

    git_output_result(repo_path, &args, output)
}

fn git_output_result(
    repo_path: &Path,
    args: &[String],
    output: std::process::Output,
) -> Result<String, String> {

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

/// Network Git actions must not strand the entire app if a remote stops
/// responding. This activity guard covers servers that never start a
/// transfer, without overriding Git's own (or the repository's) HTTP
/// configuration. It deliberately does not impose a total runtime limit: a
/// large backup may take longer than two minutes while still making steady
/// progress.
fn git_network_owned(repo_path: &Path, args: Vec<String>) -> Result<String, String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Could not run git: {err}"))?;
    let started = Instant::now();
    let last_activity = Arc::new(AtomicU64::new(0));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture git output.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture git error output.".to_string())?;
    let stdout_activity = Arc::clone(&last_activity);
    let stdout_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 1024];
        loop {
            let Ok(count) = reader.read(&mut buffer) else {
                break;
            };
            if count == 0 {
                break;
            }
            stdout_activity.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            bytes.extend_from_slice(&buffer[..count]);
        }
        bytes
    });
    let stderr_activity = Arc::clone(&last_activity);
    let stderr_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 1024];
        loop {
            let Ok(count) = reader.read(&mut buffer) else {
                break;
            };
            if count == 0 {
                break;
            }
            stderr_activity.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            bytes.extend_from_slice(&buffer[..count]);
        }
        bytes
    });

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("Could not wait for git: {err}"))?
        {
            let output = Output {
                status,
                stdout: stdout_reader.join().unwrap_or_default(),
                stderr: stderr_reader.join().unwrap_or_default(),
            };
            return git_output_result(repo_path, &args, output);
        }
        if network_operation_is_idle(
            started.elapsed(),
            last_activity.load(Ordering::Relaxed),
        ) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "git -C {} {}\nNetwork operation was idle for {} seconds. Check the remote and try again.",
                repo_path.display(),
                args.join(" "),
                NETWORK_IDLE_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn emit_git_progress(app: &AppHandle, path: &str, phase: impl Into<String>, message: impl Into<String>) {
    let _ = app.emit(
        "git-progress",
        GitProgress {
            path: path.to_string(),
            phase: phase.into(),
            message: message.into(),
        },
    );
}

/// The streaming counterpart to `git_network_owned`, used for pushes. Git
/// writes transfer progress to stderr, so capture it in a reader thread and
/// emit fragments immediately. `--progress` forces this information even when
/// the app is not attached to a terminal.
fn git_network_owned_with_progress(
    app: &AppHandle,
    repo_path: &Path,
    args: Vec<String>,
    phase: &str,
) -> Result<String, String> {
    let mut command_args = args;
    if command_args.first().is_some_and(|arg| arg == "push")
        && !command_args.iter().any(|arg| arg == "--progress")
    {
        command_args.insert(1, "--progress".to_string());
    }

    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(&command_args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Could not run git: {err}"))?;
    let started = Instant::now();
    let last_activity = Arc::new(AtomicU64::new(0));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture git output.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture git progress.".to_string())?;
    let stdout_activity = Arc::clone(&last_activity);
    let stdout_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 1024];
        loop {
            let Ok(count) = reader.read(&mut buffer) else {
                break;
            };
            if count == 0 {
                break;
            }
            stdout_activity.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            bytes.extend_from_slice(&buffer[..count]);
        }
        bytes
    });
    let progress_app = app.clone();
    let progress_path = repo_path.to_string_lossy().to_string();
    let progress_phase = phase.to_string();
    let stderr_activity = Arc::clone(&last_activity);
    let stderr_reader = thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut all = Vec::new();
        let mut buffer = [0u8; 1024];
        let mut last_progress_emit = Instant::now();
        loop {
            let Ok(count) = reader.read(&mut buffer) else {
                break;
            };
            if count == 0 {
                break;
            }
            stderr_activity.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            let chunk = &buffer[..count];
            all.extend_from_slice(chunk);
            let text = String::from_utf8_lossy(chunk).replace('\r', "\n");
            for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                if last_progress_emit.elapsed() < GIT_PROGRESS_EMIT_INTERVAL {
                    continue;
                }
                emit_git_progress(&progress_app, &progress_path, progress_phase.clone(), line);
                last_progress_emit = Instant::now();
            }
        }
        all
    });
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("Could not wait for git: {err}"))?
        {
            break status;
        }
        if network_operation_is_idle(
            started.elapsed(),
            last_activity.load(Ordering::Relaxed),
        ) {
            let _ = child.kill();
            let _ = child.wait();
            // Do not wait for the reader threads here. A misbehaving Git
            // transport helper can retain the inherited pipe after its parent
            // dies; waiting for it would recreate the very UI stall this guard
            // is meant to prevent.
            let message = format!(
                "No network activity for {} seconds.",
                NETWORK_IDLE_TIMEOUT.as_secs()
            );
            emit_git_progress(app, &repo_path.to_string_lossy(), phase, message.clone());
            return Err(format!(
                "git -C {} {}\nNetwork operation {} Check the remote and try again.",
                repo_path.display(),
                command_args.join(" "),
                message.to_lowercase()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    };
    let output = Output {
        status,
        stdout: stdout_reader.join().unwrap_or_default(),
        stderr: stderr_reader.join().unwrap_or_default(),
    };
    git_output_result(repo_path, &command_args, output)
}

/// Runs git and returns (success, stdout, stderr) without folding a non-zero
/// exit into an error. Needed for commands like `merge` and `merge-tree` that
/// signal conflicts via a non-zero exit while still producing useful stdout.
fn git_raw(repo_path: &Path, args: &[&str]) -> Result<(bool, String, String), String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|err| format!("Could not run git: {err}"))?;

    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

fn ensure_git_repo(repo_path: &Path) -> Result<(), String> {
    if git(repo_path, &["rev-parse", "--show-toplevel"]).is_ok() {
        return Ok(());
    }
    git(repo_path, &["init"])?;
    Ok(())
}

/// Check that a folder we are about to create can actually be created.
///
/// Without this, `git worktree add` into an unwritable location fails with its
/// own text and the whole command echoed back — accurate, and useless to
/// anyone who isn't reading git's source. Walks up to the nearest ancestor
/// that exists and probes it, because that is the directory git will write in.
fn writable_ancestor(directory: &Path) -> Result<(), String> {
    let mut ancestor = directory;
    while !ancestor.exists() {
        match ancestor.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => ancestor = parent,
            _ => return Err(format!("{} is not a path this computer has.", directory.display())),
        }
    }

    if !ancestor.is_dir() {
        return Err(format!(
            "{} is a file, so a folder can't be created inside it.",
            ancestor.display()
        ));
    }

    // Permission bits alone don't answer this: ownership, ACLs and read-only
    // mounts all decide it too. Creating something is the only honest test.
    //
    // The name has to be unique per call, not per process. Keyed on the pid
    // alone, two probes of the same directory at once collided: the second
    // create failed with "already exists" and was reported as "you cannot write
    // here". It surfaced as a test that failed roughly one run in three,
    // because the suite runs in parallel threads inside one process, and it
    // would have done the same to two concurrent adds in the app.
    static PROBE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let unique = PROBE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let probe = ancestor.join(format!(".gitty-write-test-{}-{unique}", std::process::id()));
    let _ = fs::remove_dir_all(&probe);
    match fs::create_dir(&probe) {
        Ok(()) => {
            let _ = fs::remove_dir_all(&probe);
            Ok(())
        }
        Err(err) => Err(format!(
            "Gitty can't create a folder in {} ({err}). Choose somewhere you can write to.",
            ancestor.display()
        )),
    }
}

/// When this repository last successfully reached its remote.
///
/// Read from `FETCH_HEAD`'s modification time rather than anything Gitty
/// stores. Git rewrites that file on every fetch, including one that brings
/// nothing back, so the answer survives restarts, needs no cache to keep in
/// sync, and stays correct when the user fetches from a terminal instead.
///
/// `--git-common-dir` rather than `--git-dir`: a linked worktree has its own
/// git dir, but FETCH_HEAD lives in the shared one.
///
/// A *failed* fetch still rewrites FETCH_HEAD, so mtime alone would report a
/// remote we could not reach as freshly contacted — the exact "in sync about a
/// remote we never talked to" claim the unknown state exists to prevent. Git
/// truncates the file to nothing when the fetch fails and writes one line per
/// ref when it succeeds, so an empty file means the last attempt did not land.
fn last_fetched_at(repo_path: &Path) -> Option<u64> {
    let common = git(repo_path, &["rev-parse", "--git-common-dir"]).ok()?;
    let common = PathBuf::from(common.trim());
    let common = if common.is_absolute() {
        common
    } else {
        repo_path.join(common)
    };
    let meta = fs::metadata(common.join("FETCH_HEAD")).ok()?;
    if meta.len() == 0 {
        return None;
    }
    meta.modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|since| since.as_millis() as u64)
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
        has_uncommitted_changes: None,
        last_activity_at: None,
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
    // A branch's upstream is the strongest signal of the user's primary
    // remote. This matters once a backup named alphabetically before (for
    // example) `github` is added: it must never become the push/fetch source
    // merely because `git remote` sorts names.
    if let Some((remote, _)) = upstream(repo_path).as_deref().and_then(|name| name.split_once('/')) {
        if output.lines().any(|name| name == remote) {
            return Some(remote.to_string());
        }
    }
    output
        .lines()
        .find(|name| *name == "origin")
        .or_else(|| output.lines().next())
        .map(str::to_string)
        .filter(|name| !name.is_empty())
}

/// The primary remote is the repository's source of truth: Gitty fetches from
/// it, tracks branches against it, and pushes there before attempting any
/// backup copies. `origin` is Git's conventional primary name; fall back to
/// the first configured remote for repos which use another convention.
fn backup_remote_names(repo_path: &Path, primary: &str) -> Vec<String> {
    git(repo_path, &["remote"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != primary)
        .map(str::to_string)
        .collect()
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

/// Tag name -> the commit it ultimately points at.
///
/// `%(objectname)` is the *tag object's* hash for an annotated tag, and the
/// commit's hash for a lightweight one. The remote side reads `ls-remote`,
/// which reports both `refs/tags/x` and the peeled `refs/tags/x^{}` and keeps
/// the peeled commit. Comparing one against the other therefore never matched
/// for an annotated tag, and every one of them was reported as unpushed for
/// ever: in one repository, 72 of 244 tags, all of them present on the remote.
///
/// `%(*objectname)` is the peeled commit and is empty for a lightweight tag, so
/// preferring it and falling back gives the same thing on both sides.
fn local_tag_hashes(repo_path: &Path) -> HashMap<String, String> {
    let Ok(output) = git(
        repo_path,
        &[
            "for-each-ref",
            "refs/tags",
            "--format=%(refname:short)\x1f%(objectname)\x1f%(*objectname)",
        ],
    ) else {
        return HashMap::new();
    };

    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let name = parts.next()?.to_string();
            let object = parts.next()?.to_string();
            let peeled = parts.next().unwrap_or("").to_string();
            let hash = if peeled.is_empty() { object } else { peeled };
            if name.is_empty() || hash.is_empty() {
                return None;
            }
            Some((name, hash))
        })
        .collect()
}

fn remote_tag_hashes(repo_path: &Path, remote: &str) -> HashMap<String, String> {
    let Ok(output) = git_network_owned(
        repo_path,
        vec!["ls-remote".to_string(), "--tags".to_string(), remote.to_string()],
    ) else {
        return HashMap::new();
    };

    let mut map = HashMap::new();
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let Some(hash) = parts.next() else {
            continue;
        };
        let Some(refname) = parts.next() else {
            continue;
        };
        let Some(name) = refname.strip_prefix("refs/tags/") else {
            continue;
        };
        if let Some(base) = name.strip_suffix("^{}") {
            map.insert(base.to_string(), hash.to_string());
        } else {
            map.entry(name.to_string()).or_insert_with(|| hash.to_string());
        }
    }
    map
}

fn unpushed_tags_to_remote(repo_path: &Path, remote: &str) -> Vec<String> {
    let local = local_tag_hashes(repo_path);
    if local.is_empty() {
        return Vec::new();
    }

    let remote = remote_tag_hashes(repo_path, remote);
    local
        .into_iter()
        .filter(|(name, hash)| remote.get(name).map_or(true, |remote_hash| remote_hash != hash))
        .map(|(name, _)| name)
        .collect()
}

/// The commits on HEAD that no remote has yet, newest first.
///
/// The push button reported a count and nothing said which commits it meant, so
/// "16 to push" was a number you had to take on trust. The timeline can only
/// draw the boundary if it is told where the boundary is, and it cannot work
/// that out itself: an unpublished branch has no ref on it to anchor to.
///
/// The anchor is the branch's own upstream when it has one. When it does not,
/// the remote's copy of the trunk is the honest answer — nothing on this branch
/// has been pushed anywhere, so everything since it left the trunk is new to
/// the remote. With no remotes at all there is nothing to be ahead of.
fn unpushed_commit_hashes(
    repo_path: &Path,
    upstream: &Option<String>,
    branch: &str,
    trunk: Option<&str>,
    has_remotes: bool,
) -> Vec<String> {
    if !has_remotes {
        return Vec::new();
    }

    // Same ladder `ahead_behind` and `branch_published` use, and for the same
    // reason: a branch can exist on the remote without a configured upstream
    // -- fetched from a colleague, or tracking lost in a config edit. Skipping
    // the `<remote>/<branch>` rung and going straight to the trunk marked every
    // commit since the fork point as unpushed while the header, which does
    // check that rung, said the branch was in sync. The strip and the button
    // must not disagree about what has been pushed.
    let base = match upstream {
        Some(name) if !name.is_empty() => name.clone(),
        _ => {
            let remote = match default_remote_name(repo_path) {
                Some(remote) => remote,
                None => return Vec::new(),
            };
            let own = format!("{remote}/{branch}");
            let own_exists = !is_detached_branch(branch)
                && git_raw(repo_path, &["rev-parse", "--verify", "--quiet", &own])
                    .map(|(ok, _, _)| ok)
                    .unwrap_or(false);
            if own_exists {
                own
            } else {
                match trunk {
                    Some(trunk) => format!("{remote}/{trunk}"),
                    None => return Vec::new(),
                }
            }
        }
    };

    // The base can be absent — a brand-new repository, or a trunk that exists
    // locally but was never pushed. Saying "everything is unpushed" from a
    // missing ref would be a guess, so say nothing.
    let found = git_raw(repo_path, &["rev-parse", "--verify", "--quiet", &base])
        .map(|(ok, _, _)| ok)
        .unwrap_or(false);
    if !found {
        return Vec::new();
    }

    // Capped: this feeds a strip that draws a few dozen nodes, and a branch
    // thousands of commits from its base does not need every hash to mark one
    // boundary.
    git_owned(
        repo_path,
        vec![
            "rev-list".to_string(),
            "--max-count=400".to_string(),
            format!("{base}..HEAD"),
        ],
    )
    .map(|out| {
        out.lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect()
    })
    .unwrap_or_default()
}

fn unpushed_tags(repo_path: &Path) -> Vec<String> {
    default_remote_name(repo_path)
        .map(|remote| unpushed_tags_to_remote(repo_path, &remote))
        .unwrap_or_default()
}

/// Which tags a push should carry, given whether the caller opted in.
///
/// This is a one-line decision, extracted because it is made twice -- once for
/// the primary remote and once per backup -- and the two disagreed. The backup
/// path computed its tags unconditionally, so a commits-only push still copied
/// every unpushed tag to every backup remote, which on a fork means the
/// upstream's entire release history published under your name. Having one
/// function to call is what makes the rule testable rather than restated.
fn tags_for_push(repo_path: &Path, opt_in: bool) -> Vec<String> {
    if opt_in {
        unpushed_tags(repo_path)
    } else {
        Vec::new()
    }
}

fn backup_tags_for_push(repo_path: &Path, remote: &str, opt_in: bool) -> Vec<String> {
    if opt_in {
        unpushed_tags_to_remote(repo_path, remote)
    } else {
        Vec::new()
    }
}

fn backup_push_pending(repo_path: &Path) -> bool {
    git(repo_path, &["config", "--bool", "--get", "gitty.backup-push-pending"])
        .map(|value| value == "true")
        .unwrap_or(false)
}

fn set_backup_push_pending(repo_path: &Path, pending: bool) {
    if pending {
        let _ = git(repo_path, &["config", "gitty.backup-push-pending", "true"]);
    } else if backup_push_pending(repo_path) {
        // This is local Gitty bookkeeping, never a repository file or shared
        // config. Ignore a failed cleanup: it merely leaves Retry Push visible.
        let _ = git(repo_path, &["config", "--unset-all", "gitty.backup-push-pending"]);
    }
}

fn backup_on_push(repo_path: &Path) -> bool {
    git(repo_path, &["config", "--bool", "--get", "gitty.backup-on-push"])
        .map(|value| value == "true")
        .unwrap_or(false)
}

fn write_backup_on_push(repo_path: &Path, enabled: bool) -> Result<(), String> {
    git_owned(
        repo_path,
        vec![
            "config".to_string(),
            "gitty.backup-on-push".to_string(),
            enabled.to_string(),
        ],
    )?;
    Ok(())
}

fn tag_list(repo_path: &Path, unpushed: &HashSet<String>) -> Vec<TagEntry> {
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

/// Whether the current branch already exists on a remote. A branch created
/// locally that has never been pushed has no remote counterpart — the push
/// button should light up to offer publishing it, even when it has no commits
/// ahead of the remote. Returns `true` (i.e. "nothing to publish") for detached
/// HEADs and repos without any remote, where publishing a branch is moot.
fn branch_published(repo_path: &Path, branch: &str, upstream: &Option<String>) -> bool {
    if upstream.is_some() {
        return true;
    }
    if is_detached_branch(branch) {
        return true;
    }
    let Some(remote) = default_remote_name(repo_path) else {
        return true;
    };
    let remote_ref = format!("{remote}/{branch}");
    git(repo_path, &["rev-parse", "--verify", &remote_ref]).is_ok()
}

fn changed_files(repo_path: &Path) -> Vec<FileChange> {
    // `-z` gives NUL-separated records with raw, unquoted paths. Without it git
    // C-quotes any path containing spaces or non-ASCII bytes (e.g. `"a b/c.png"`),
    // and those literal quotes/escapes would then be passed back to `git add`.
    let Ok(output) = git(repo_path, &["status", "--porcelain=v1", "-uall", "-z"]) else {
        return Vec::new();
    };

    let mut changes = Vec::new();
    let mut fields = output.split('\0');
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let status = entry[0..2].to_string();
        let path = entry[3..].to_string();
        // Renames/copies emit the original path as the next NUL-separated field.
        let old_path = if status.starts_with('R') || status.starts_with('C') {
            fields.next().map(str::to_string)
        } else {
            None
        };
        changes.push(FileChange {
            status,
            path,
            old_path,
        });
    }
    changes
}

fn repo_has_uncommitted_changes(repo_path: &Path) -> bool {
    git(repo_path, &["status", "--porcelain=v1", "-uall", "-z"])
        .map(|output| !output.is_empty())
        .unwrap_or(false)
}

/// The reflog changes whenever HEAD moves, which makes it a cheap, local signal
/// for which repositories have seen Git activity most recently.
fn repo_last_activity_at(repo_path: &Path) -> Option<u64> {
    fs::metadata(repo_path.join(".git/logs/HEAD"))
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .or_else(|| {
            git(repo_path, &["log", "-1", "--format=%ct"])
                .ok()
                .and_then(|timestamp| timestamp.trim().parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1_000))
        })
}

fn with_repo_status(mut repo: RepoEntry) -> RepoEntry {
    repo.has_uncommitted_changes = Some(repo_has_uncommitted_changes(Path::new(&repo.path)));
    repo.last_activity_at = repo_last_activity_at(Path::new(&repo.path));
    repo
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

/// First-parent-reachable history of HEAD — the linear "your branch" ancestry
/// that the working-tree timeline and commit picker rely on. Distinct from the
/// multi-branch `graph_log_page`, which the history graph uses.
fn commit_log(repo_path: &Path, limit: u32) -> Vec<CommitEntry> {
    commit_log_page(repo_path, 0, limit)
}

fn commit_log_page(repo_path: &Path, skip: u32, limit: u32) -> Vec<CommitEntry> {
    let limit = limit.clamp(1, 100).to_string();
    let skip = skip.to_string();
    commit_log_with_args(repo_path, &["-n", &limit, "--skip", &skip])
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

/// Commits in `left` not in `right`, and in `right` not in `left`, via a single
/// `rev-list --left-right --count`. Returns None when either ref is unresolvable.
fn divergence(repo_path: &Path, left: &str, right: &str) -> Option<(u32, u32)> {
    let range = format!("{left}...{right}");
    let output = git(repo_path, &["rev-list", "--left-right", "--count", &range]).ok()?;
    let mut parts = output.split_whitespace();
    let ahead = parts.next()?.parse().ok()?;
    let behind = parts.next()?.parse().ok()?;
    Some((ahead, behind))
}

/// The project's trunk: a local `main`, else a local `master`. The branch the
/// rest of the world expects a feature branch to stay current with.
fn integration_branch(branches: &[BranchEntry]) -> Option<String> {
    let locals: Vec<&str> = branches
        .iter()
        .filter(|b| !b.is_remote)
        .map(|b| b.name.as_str())
        .collect();
    if locals.contains(&"main") {
        Some("main".to_string())
    } else if locals.contains(&"master") {
        Some("master".to_string())
    } else {
        None
    }
}

/// Divergence between HEAD and one reference branch, with the reference's
/// commits HEAD is missing (newest first, capped) for the timeline lane.
fn divergence_for_ref(
    repo_path: &Path,
    reference: &str,
    display: &str,
    kind: &str,
    limit: u32,
) -> Option<BranchDivergence> {
    if !rev_exists(repo_path, reference) {
        return None;
    }
    // ahead = commits HEAD has that the reference lacks; behind = the reverse.
    let (ahead, behind) = divergence(repo_path, "HEAD", reference)?;
    let merge_base = git(repo_path, &["merge-base", "HEAD", reference])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Only the reference's side of the fork — what you'd gain by updating.
    let commits = if behind > 0 {
        let range = format!("HEAD..{reference}");
        let limit_str = limit.clamp(1, 100).to_string();
        commit_log_with_args(repo_path, &[&range, "-n", &limit_str])
    } else {
        Vec::new()
    };

    Some(BranchDivergence {
        ref_name: display.to_string(),
        kind: kind.to_string(),
        merge_base,
        behind,
        ahead,
        commits,
    })
}

/// The reference branches the working-tree timeline draws context lanes for: the
/// trunk (when you're not on it) and the current branch's own upstream. Only
/// references that exist and actually diverge are returned.
fn timeline_context(
    repo_path: &Path,
    branch: &str,
    upstream: &Option<String>,
    branches: &[BranchEntry],
    limit: u32,
) -> Vec<BranchDivergence> {
    let mut lanes = Vec::new();

    if let Some(trunk) = integration_branch(branches) {
        if trunk != branch {
            if let Some(d) = divergence_for_ref(repo_path, &trunk, &trunk, "integration", limit) {
                lanes.push(d);
            }
        }
    }

    if let Some(up) = upstream {
        // Skip a redundant lane when the upstream resolves to the trunk we already added.
        let already = lanes.iter().any(|l| &l.ref_name == up);
        if !already {
            if let Some(d) = divergence_for_ref(repo_path, up, up, "upstream", limit) {
                lanes.push(d);
            }
        }
    }

    lanes
}

fn branch_list(repo_path: &Path, include_divergence: bool) -> Vec<BranchEntry> {
    let current = git(repo_path, &["branch", "--show-current"]).unwrap_or_default();
    let Ok(output) = git(
        repo_path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "refs/heads/",
            "refs/remotes/",
            "--format=%(refname:short)\x1f%(upstream:short)\x1f%(refname)\x1f%(objectname)\x1f%(objectname:short)\x1f%(committerdate:iso-strict)",
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
            let tip_hash = parts.next().filter(|v| !v.is_empty()).map(str::to_string);
            let tip_short_hash = parts.next().filter(|v| !v.is_empty()).map(str::to_string);
            let last_commit_date = parts.next().filter(|v| !v.is_empty()).map(str::to_string);
            let is_remote = full_ref.starts_with("refs/remotes/");
            let is_current = !current.is_empty() && name == current;

            // Position relative to the branch the user is on, so the working-tree
            // view can answer "main is N ahead of me" without a round trip.
            let (ahead, behind) = if !include_divergence || is_current || current.is_empty() {
                (Some(0), Some(0))
            } else {
                match divergence(repo_path, &name, &current) {
                    Some((a, b)) => (Some(a), Some(b)),
                    None => (None, None),
                }
            };

            let (ahead_upstream, behind_upstream) = if !include_divergence {
                (None, None)
            } else {
                match &upstream {
                    Some(up) => match divergence(repo_path, &name, up) {
                        Some((a, b)) => (Some(a), Some(b)),
                        None => (None, None),
                    },
                    None => (None, None),
                }
            };

            Some(BranchEntry {
                name,
                is_remote,
                is_current,
                upstream,
                tip_hash,
                tip_short_hash,
                last_commit_date,
                ahead,
                behind,
                ahead_upstream,
                behind_upstream,
            })
        })
        .collect()
}

/// Number of seconds in the "recently active" window for remote branches that
/// we fold into the graph log. Local branches are always included.
const ACTIVE_BRANCH_WINDOW_SECS: u64 = 60 * 60 * 24 * 30;

/// The set of refs whose history the graph should show: HEAD, every local
/// branch, their upstreams, and any remote branch with a commit inside the
/// active window. This is what lets parallel lanes exist in the graph at all —
/// a bare `git log HEAD` can only ever draw the current branch's ancestry.
fn graph_log_refs(repo_path: &Path) -> Vec<String> {
    let Ok(output) = git(
        repo_path,
        &[
            "for-each-ref",
            "refs/heads/",
            "refs/remotes/",
            "--format=%(refname)\x1f%(committerdate:unix)\x1f%(upstream)",
        ],
    ) else {
        return vec!["HEAD".to_string()];
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cutoff = now.saturating_sub(ACTIVE_BRANCH_WINDOW_SECS);

    let mut refs: Vec<String> = vec!["HEAD".to_string()];
    let mut tracked_upstreams: Vec<String> = Vec::new();
    let mut remotes: Vec<(String, u64)> = Vec::new();

    for line in output.lines() {
        let mut parts = line.split('\x1f');
        let Some(refname) = parts.next() else { continue };
        if refname.is_empty() || refname.ends_with("/HEAD") {
            continue;
        }
        let when: u64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        let upstream = parts.next().unwrap_or_default();

        if refname.starts_with("refs/heads/") {
            refs.push(refname.to_string());
            if !upstream.is_empty() {
                tracked_upstreams.push(upstream.to_string());
            }
        } else if refname.starts_with("refs/remotes/") {
            remotes.push((refname.to_string(), when));
        }
    }

    for (refname, when) in remotes {
        if when >= cutoff || tracked_upstreams.contains(&refname) {
            refs.push(refname);
        }
    }

    refs.sort();
    refs.dedup();
    refs
}

/// Like `commit_log_page`, but spanning the active branch set so the graph can
/// render parallel lanes. Order is `--date-order` for a readable graph.
fn graph_log_page(repo_path: &Path, skip: u32, limit: u32) -> Vec<CommitEntry> {
    let limit = limit.clamp(1, 100).to_string();
    let skip = skip.to_string();
    let refs = graph_log_refs(repo_path);
    let mut args: Vec<&str> = vec!["--date-order", "-n", &limit, "--skip", &skip];
    let ref_args: Vec<&str> = refs.iter().map(String::as_str).collect();
    args.extend(ref_args);
    commit_log_with_args(repo_path, &args)
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
async fn resolve_repo_icon(
    app: AppHandle,
    path: String,
    force_rescan: Option<bool>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        repo_icon::resolve_repo_icon(&app, Path::new(&repo.path), force_rescan.unwrap_or(false))
    })
    .await
    .map_err(|err| format!("Icon task failed: {err}"))?
}

#[tauri::command]
async fn list_repo_images(path: String) -> Result<Vec<repo_icon::RepoImage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        Ok(repo_icon::list_repo_images(Path::new(&repo.path)))
    })
    .await
    .map_err(|err| format!("Icon image task failed: {err}"))?
}

#[tauri::command]
async fn set_repo_icon(
    app: AppHandle,
    path: String,
    relative_path: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        repo_icon::set_repo_icon_override(&app, &repo.path, &relative_path)?;
        repo_icon::resolve_repo_icon(&app, Path::new(&repo.path), false)
    })
    .await
    .map_err(|err| format!("Set icon task failed: {err}"))?
}

#[tauri::command]
async fn clear_repo_icon(app: AppHandle, path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        repo_icon::clear_repo_icon_override(&app, &repo.path)?;
        repo_icon::resolve_repo_icon(&app, Path::new(&repo.path), false)
    })
    .await
    .map_err(|err| format!("Clear icon task failed: {err}"))?
}

#[tauri::command]
async fn list_repos(app: AppHandle) -> Result<Vec<RepoEntry>, String> {
    // Startup only needs the persisted list. A full `git status -uall` for
    // every saved repository turns opening the app into N working-tree scans;
    // selected repositories refresh their status as part of the snapshot path.
    tauri::async_runtime::spawn_blocking(move || load_repos_from_disk(&app))
        .await
        .map_err(|err| format!("Repository list task failed: {err}"))?
}

#[tauri::command]
fn add_repo(app: AppHandle, path: String) -> Result<Vec<RepoEntry>, String> {
    let path_buf = PathBuf::from(path.trim());
    if path_buf.as_os_str().is_empty() {
        return Err("Repository path is required.".to_string());
    }
    if !path_buf.exists() {
        return Err(format!("{} does not exist", path_buf.display()));
    }
    ensure_git_repo(&path_buf)?;
    let repo = normalize_repo(&path_buf.to_string_lossy())?;
    let mut repos = load_repos_from_disk(&app)?;

    if !repos.iter().any(|existing| existing.path == repo.path) {
        repos.push(repo.clone());
        save_repos_to_disk(&app, &repos)?;
        repo_icon::warm_repo_icon_cache(&app, &repo.path)?;
    }

    Ok(repos.into_iter().map(with_repo_status).collect())
}

#[tauri::command]
fn remove_repo(app: AppHandle, path: String) -> Result<Vec<RepoEntry>, String> {
    let mut repos = load_repos_from_disk(&app)?;
    repos.retain(|repo| repo.path != path);
    save_repos_to_disk(&app, &repos)?;
    repo_icon::clear_repo_icon_cache(&app, &path)?;
    Ok(repos.into_iter().map(with_repo_status).collect())
}

#[tauri::command]
fn reorder_repos(app: AppHandle, paths: Vec<String>) -> Result<Vec<RepoEntry>, String> {
    let repos = load_repos_from_disk(&app)?;
    let order: HashMap<&str, usize> = paths
        .iter()
        .enumerate()
        .map(|(index, path)| (path.as_str(), index))
        .collect();
    let mut reordered = repos.clone();
    // Stable sort by the requested position; paths not present in the request
    // keep their relative order and sink to the end.
    reordered.sort_by_key(|repo| order.get(repo.path.as_str()).copied().unwrap_or(usize::MAX));
    save_repos_to_disk(&app, &reordered)?;
    Ok(reordered.into_iter().map(with_repo_status).collect())
}

fn repo_snapshot_blocking(
    path: String,
    limit: Option<u32>,
    lite: bool,
    include_tags: bool,
) -> Result<RepoSnapshot, String> {
    let mut repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    repo.last_activity_at = repo_last_activity_at(&repo_path);
    let log_limit = limit.unwrap_or(40);

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
        let branches_handle = scope.spawn(|| branch_list(&repo_path_branches, !lite));
        (
            changes_handle.join().unwrap(),
            commits_handle.join().unwrap(),
            remotes_handle.join().unwrap(),
            branches_handle.join().unwrap(),
        )
    });

    let (ahead, behind) = ahead_behind(&repo_path, &branch, &upstream);
    let branch_unpublished =
        !remotes.is_empty() && !branch_published(&repo_path, &branch, &upstream);

    // Branch-context lanes drive the working-tree view that even the lite snapshot
    // renders, so compute them unconditionally. The cost is a handful of git calls —
    // trivial next to `branch_list`, which already runs a divergence per branch in
    // lite mode too. (Gating this behind `!lite` left the lanes empty on the first
    // post-switch snapshot, so they only appeared after a manual refresh.)
    let repo_path_ctx = repo_path.clone();
    let branch_for_ctx = branch.clone();
    let upstream_for_ctx = upstream.clone();
    let branches_for_ctx = branches.clone();
    let timeline_ctx = std::thread::scope(|scope| {
        scope
            .spawn(move || {
                timeline_context(
                    &repo_path_ctx,
                    &branch_for_ctx,
                    &upstream_for_ctx,
                    &branches_for_ctx,
                    log_limit,
                )
            })
            .join()
            .unwrap()
    });

    let (ahead_commits, ahead_branch, tags, unpushed_tag_names) = if lite {
        (Vec::new(), None, Vec::new(), Vec::new())
    } else {
        let repo_path_ahead = repo_path.clone();
        let commits_for_ahead = commits.clone();
        let branch_for_ahead = branch.clone();
        std::thread::scope(|scope| {
            let ahead_handle = scope.spawn(move || {
                ahead_commits(
                    &repo_path_ahead,
                    &commits_for_ahead,
                    log_limit,
                    &branch_for_ahead,
                )
            });
            let (ahead_commits, ahead_branch) = ahead_handle.join().unwrap();
            let (tags, unpushed) = if include_tags {
                let unpushed = unpushed_tags(&repo_path);
                let unpushed_set: HashSet<String> = unpushed.iter().cloned().collect();
                (tag_list(&repo_path, &unpushed_set), unpushed)
            } else {
                (Vec::new(), Vec::new())
            };
            (ahead_commits, ahead_branch, tags, unpushed)
        })
    };

    let trunk = integration_branch(&branches);
    let unpushed_commits =
        unpushed_commit_hashes(&repo_path, &upstream, &branch, trunk.as_deref(), !remotes.is_empty());
    let sibling = sibling_tip(&repo_path, &branch, &branches, &trunk);

    let is_clean = changes.is_empty();
    repo.has_uncommitted_changes = Some(!is_clean);

    Ok(RepoSnapshot {
        repo,
        branch,
        upstream,
        ahead,
        behind,
        is_clean,
        changes,
        commits,
        // Branch graph construction is deferred until its view is opened.
        graph_commits: Vec::new(),
        ahead_commits,
        ahead_branch,
        remotes,
        branches,
        timeline_context: timeline_ctx,
        sibling_tip: sibling,
        tags,
        unpushed_tags: unpushed_tag_names,
        unpushed_commits,
        branch_unpublished,
        backup_push_pending: backup_push_pending(&repo_path),
        backup_on_push: backup_on_push(&repo_path),
        last_fetched_at: last_fetched_at(&repo_path),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoChanges {
    changes: Vec<FileChange>,
    is_clean: bool,
}

/// Metadata that can change while Gitty is in the background. This deliberately
/// excludes the working tree: an edited file can retain the same porcelain
/// status, so the frontend refreshes that separately when the window regains
/// focus.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoFocusState {
    fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoEnrichment {
    ahead_commits: Vec<CommitEntry>,
    ahead_branch: Option<String>,
    tags: Vec<TagEntry>,
    unpushed_tags: Vec<String>,
}

fn repo_enrich_blocking(
    path: String,
    ahead_limit: Option<u32>,
    include_tags: bool,
) -> Result<RepoEnrichment, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let branch = current_branch(&repo_path);
    let limit = ahead_limit.unwrap_or(40).clamp(1, 400);

    let repo_path_ahead = repo_path.clone();
    let branch_for_ahead = branch.clone();
    std::thread::scope(|scope| {
        let ahead_handle = scope.spawn(move || {
            ahead_commits(&repo_path_ahead, &[], limit, &branch_for_ahead)
        });
        let (ahead_commits, ahead_branch) = ahead_handle.join().unwrap();
        let (tags, unpushed) = if include_tags {
            let unpushed = unpushed_tags(&repo_path);
            let unpushed_set: HashSet<String> = unpushed.iter().cloned().collect();
            (tag_list(&repo_path, &unpushed_set), unpushed)
        } else {
            (Vec::new(), Vec::new())
        };
        Ok(RepoEnrichment {
            ahead_commits,
            ahead_branch,
            tags,
            unpushed_tags: unpushed,
        })
    })
}

#[tauri::command]
async fn repo_enrich(
    path: String,
    ahead_limit: Option<u32>,
    include_tags: Option<bool>,
) -> Result<RepoEnrichment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        repo_enrich_blocking(path, ahead_limit, include_tags.unwrap_or(true))
    })
        .await
        .map_err(|err| format!("Enrich task failed: {err}"))?
}

#[tauri::command]
async fn repo_commits(
    path: String,
    skip: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<CommitEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        let skip = skip.unwrap_or(0);
        let limit = limit.unwrap_or(50);
        Ok(graph_log_page(Path::new(&repo.path), skip, limit))
    })
    .await
    .map_err(|err| format!("Graph task failed: {err}"))?
}

#[tauri::command]
async fn repo_changes(path: String) -> Result<RepoChanges, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        let changes = changed_files(Path::new(&repo.path));
        Ok(RepoChanges {
            is_clean: changes.is_empty(),
            changes,
        })
    })
    .await
    .map_err(|err| format!("Changes task failed: {err}"))?
}

#[tauri::command]
async fn repo_focus_state(path: String) -> Result<RepoFocusState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        let repo_path = Path::new(&repo.path);

        // `for-each-ref` includes local branches, fetched remote refs, and tags;
        // `current_branch` also catches switching between branches at the same tip.
        // Remote URLs live in config rather than refs, so include those as well.
        let refs = git(
            repo_path,
            &[
                "for-each-ref",
                "--format=%(refname)%00%(objectname)%00%(*objectname)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;
        let remotes = git(repo_path, &["remote", "-v"])?;

        Ok(RepoFocusState {
            fingerprint: format!("{}\n{refs}\n{remotes}", current_branch(repo_path)),
        })
    })
    .await
    .map_err(|err| format!("Focus task failed: {err}"))?
}

fn snapshot_was_superseded(generation: Option<u64>) -> bool {
    generation.is_some_and(|g| g != SNAPSHOT_GENERATION.load(Ordering::SeqCst))
}

#[tauri::command]
async fn repo_snapshot(
    path: String,
    limit: Option<u32>,
    generation: Option<u64>,
    lite: Option<bool>,
    include_tags: Option<bool>,
) -> Result<RepoSnapshot, String> {
    let lite = lite.unwrap_or(false);
    let include_tags = include_tags.unwrap_or(!lite);
    if let Some(g) = generation {
        SNAPSHOT_GENERATION.store(g, Ordering::SeqCst);
    }
    tauri::async_runtime::spawn_blocking(move || {
        if snapshot_was_superseded(generation) {
            return Err(SNAPSHOT_SUPERSEDED.to_string());
        }
        let result = repo_snapshot_blocking(path, limit, lite, include_tags)?;
        if snapshot_was_superseded(generation) {
            return Err(SNAPSHOT_SUPERSEDED.to_string());
        }
        Ok(result)
    })
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
            "-z".to_string(),
            commit.to_string(),
        ],
    )?;

    Ok(parse_name_status_z(&output))
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
            // A merge commit defaults to a combined diff ("diff --cc"), which
            // the frontend's parser does not understand, so it fell back to
            // dumping the raw text as wrapped prose. These two flags ask for
            // the merge's changes against its first parent in ordinary
            // "diff --git" form, which is both parseable and the comparison a
            // reader of a merge actually wants: what this merge brought in.
            // They are no-ops on an ordinary commit.
            "-m".to_string(),
            "--first-parent".to_string(),
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

fn git_apply_patch(
    repo_path: &Path,
    patch: &str,
    cached: bool,
    reverse: bool,
) -> Result<String, String> {
    let mut args = vec!["apply".to_string(), "--whitespace=nowarn".to_string()];
    if cached {
        args.push("--cached".to_string());
    }
    if reverse {
        args.push("--reverse".to_string());
    }

    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0")
        .spawn()
        .map_err(|err| format!("Could not run git apply: {err}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(patch.as_bytes())
            .map_err(|err| format!("Could not write patch to git apply: {err}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Could not finish git apply: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    let stderr = String::from_utf8_lossy(&output.stderr)
        .trim_end()
        .to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let detail = [stderr, stdout]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Err(if detail.is_empty() {
            "git apply failed.".to_string()
        } else {
            detail
        })
    }
}

fn git_apply_cached(repo_path: &Path, patch: &str, reverse: bool) -> Result<String, String> {
    git_apply_patch(repo_path, patch, true, reverse)
}

// The diff viewer renders every returned line. Keep a single file's payload
// bounded before it crosses the IPC boundary so generated files cannot lock up
// the WebView or consume unbounded renderer memory.
const MAX_DISPLAY_DIFF_BYTES: usize = 256 * 1024;

fn truncate_diff_for_display(diff: String) -> (String, bool) {
    if diff.len() <= MAX_DISPLAY_DIFF_BYTES {
        return (diff, false);
    }

    let mut end = MAX_DISPLAY_DIFF_BYTES;
    while end > 0 && !diff.is_char_boundary(end) {
        end -= 1;
    }
    (diff[..end].to_string(), true)
}

fn file_diff_parts_blocking(path: String, file_path: String) -> Result<FileDiffParts, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

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

    let mut unstaged = unstaged;
    if staged.trim().is_empty() && unstaged.trim().is_empty() {
        if let Some(untracked) = untracked_file_diff(repo_path, &file_path)? {
            unstaged = untracked;
        }
    }

    let (staged, staged_truncated) = truncate_diff_for_display(staged);
    let (unstaged, unstaged_truncated) = truncate_diff_for_display(unstaged);
    Ok(FileDiffParts {
        staged,
        unstaged,
        truncated: staged_truncated || unstaged_truncated,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDiffParts {
    staged: String,
    unstaged: String,
    truncated: bool,
}

#[tauri::command]
async fn file_diff_parts(path: String, file_path: String) -> Result<FileDiffParts, String> {
    tauri::async_runtime::spawn_blocking(move || file_diff_parts_blocking(path, file_path))
        .await
        .map_err(|err| format!("Diff task failed: {err}"))?
}

#[tauri::command]
fn stage_hunk(path: String, file_path: String, patch: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file_path = file_path.trim().to_string();
    if file_path.is_empty() {
        return Err("File path is required.".to_string());
    }
    if patch.trim().is_empty() {
        return Err("Patch is required.".to_string());
    }

    if changed_files(repo_path)
        .iter()
        .any(|change| change.path == file_path && change.status.starts_with('?'))
    {
        git(repo_path, &["add", "-N", &file_path])?;
    }

    let output = git_apply_cached(repo_path, &patch, false)?;
    Ok(ActionResult {
        message: "Hunk staged.".to_string(),
        output,
    })
}

#[tauri::command]
fn unstage_hunk(path: String, file_path: String, patch: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file_path = file_path.trim().to_string();
    if file_path.is_empty() {
        return Err("File path is required.".to_string());
    }
    if patch.trim().is_empty() {
        return Err("Patch is required.".to_string());
    }

    let output = git_apply_cached(repo_path, &patch, true)?;
    Ok(ActionResult {
        message: "Hunk unstaged.".to_string(),
        output,
    })
}

#[tauri::command]
fn discard_hunk(path: String, file_path: String, patch: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file_path = file_path.trim().to_string();
    if file_path.is_empty() {
        return Err("File path is required.".to_string());
    }
    if patch.trim().is_empty() {
        return Err("Patch is required.".to_string());
    }

    let output = git_apply_patch(repo_path, &patch, false, true)?;
    Ok(ActionResult {
        message: "Hunk discarded.".to_string(),
        output,
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
        )
        .map(|diff| truncate_diff_for_display(diff).0);
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
            return Ok(truncate_diff_for_display(untracked).0);
        }
        Ok(format!(
            "No tracked diff for {file_path}. This may be an untracked file."
        ))
    } else {
        Ok(truncate_diff_for_display(combined).0)
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
    let (output, checked_out) = if branch.contains('/') {
        // A remote-tracking ref like "origin/main". Switching to it directly
        // detaches HEAD, so prefer an existing local branch (the leaf name) and
        // only create a tracking branch when no local one exists. We never fall
        // back to a plain checkout of the remote ref, which would detach HEAD.
        let leaf = branch.splitn(2, '/').nth(1).unwrap_or("").to_string();
        let local_exists = !leaf.is_empty()
            && git(
                repo_path,
                &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{leaf}")],
            )
            .is_ok();
        if local_exists {
            let out = git(repo_path, &["switch", &leaf])
                .or_else(|_| git(repo_path, &["checkout", &leaf]))?;
            (out, leaf)
        } else {
            let out = git(repo_path, &["switch", "--track", &branch])
                .or_else(|_| git(repo_path, &["checkout", "--track", &branch]))?;
            (out, leaf.clone())
        }
    } else {
        // `git switch` carries uncommitted work across automatically; it only
        // fails when local changes would be overwritten. Translate that one case
        // from git's plumbing error into plain words.
        let out = match git(repo_path, &["switch", &branch])
            .or_else(|_| git(repo_path, &["checkout", &branch]))
        {
            Ok(out) => out,
            Err(err) => {
                // The wall you hit the day you start using worktrees: git
                // refuses to check out a branch that is already open in another
                // folder, and says so as `fatal: '<branch>' is already checked
                // out at '<path>'`. We already know that path, so name the
                // folder and let the caller offer to open it instead of showing
                // a dead end.
                if let Some(other) = existing_worktree_for(repo_path, &branch) {
                    if !same_path(&other, repo_path) {
                        return Err(format!(
                            "{branch} is already open in {}. Open that folder instead of switching here.",
                            other.display()
                        ));
                    }
                }
                if !changed_files(repo_path).is_empty() {
                    return Err(format!(
                        "Switching to {branch} would overwrite unsaved changes. Commit or set them aside first."
                    ));
                }
                return Err(err);
            }
        };
        (out, branch.clone())
    };

    let label = if checked_out.is_empty() { &branch } else { &checked_out };
    Ok(ActionResult {
        message: format!("Checked out {label}."),
        output,
    })
}

/// Create a branch at the current HEAD and switch to it. Any uncommitted work
/// comes along automatically — this is how you move changes off the trunk onto a
/// branch where they belong, without committing or stashing first.
#[tauri::command]
fn create_branch(
    path: String,
    name: String,
    start_point: Option<String>,
) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Branch name is required.".to_string());
    }
    let repo_path = Path::new(&repo.path);

    // An optional commit to fork from — right-clicking an old node in the timeline
    // branches from there rather than from HEAD. Empty/whitespace means "from HEAD".
    let start_point = start_point
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    // Reject up front so the user gets a clean message instead of git's plumbing
    // error, and so we never half-create a ref under an unusable name.
    if git(repo_path, &["check-ref-format", "--branch", &name]).is_err() {
        return Err(format!("\"{name}\" isn't a valid branch name."));
    }
    if git(
        repo_path,
        &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")],
    )
    .is_ok()
    {
        return Err(format!("A branch named \"{name}\" already exists."));
    }

    let output = match &start_point {
        Some(from) => git(repo_path, &["switch", "-c", &name, from])
            .or_else(|_| git(repo_path, &["checkout", "-b", &name, from]))?,
        None => git(repo_path, &["switch", "-c", &name])
            .or_else(|_| git(repo_path, &["checkout", "-b", &name]))?,
    };

    let message = match &start_point {
        Some(from) => {
            let short: String = from.chars().take(7).collect();
            format!("Created {name} from {short}.")
        }
        None => format!("Created {name} from this point."),
    };

    Ok(ActionResult { message, output })
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

/// Parses `git diff`/`git show --name-status -z` output into FileChange entries.
///
/// `-z` produces NUL-separated fields with raw, unquoted paths: a status field
/// followed by one path field (or two — old then new — for renames and copies).
fn parse_name_status_z(output: &str) -> Vec<FileChange> {
    let mut changes = Vec::new();
    let mut fields = output.split('\0');
    while let Some(status_part) = fields.next() {
        if status_part.is_empty() {
            continue;
        }
        let status_code = status_part.chars().next().unwrap_or('M');
        let change = match status_code {
            'R' | 'C' => {
                let old_path = match fields.next() {
                    Some(value) => value,
                    None => break,
                };
                let path = match fields.next() {
                    Some(value) => value,
                    None => break,
                };
                FileChange {
                    status: format!("{status_code} "),
                    path: path.to_string(),
                    old_path: Some(old_path.to_string()),
                }
            }
            _ => {
                let path = match fields.next() {
                    Some(value) => value,
                    None => break,
                };
                FileChange {
                    status: format!("{status_code} "),
                    path: path.to_string(),
                    old_path: None,
                }
            }
        };
        changes.push(change);
    }
    changes
}

fn rev_exists(repo_path: &Path, rev: &str) -> bool {
    git(repo_path, &["rev-parse", "--verify", "--quiet", rev]).is_ok()
}

fn unmerged_files(repo_path: &Path) -> Vec<String> {
    git(repo_path, &["diff", "--name-only", "--diff-filter=U"])
        .map(|output| {
            output
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Runs git with editors disabled so rebase/commit steps never block on an
/// interactive prompt. Used for the update (rebase) flow.
fn git_rebase(repo_path: &Path, args: &[&str]) -> Result<(bool, String, String), String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .output()
        .map_err(|err| format!("Could not run git: {err}"))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

/// True when a rebase (our "update from main") is paused, usually on conflicts.
fn rebase_in_progress(repo_path: &Path) -> bool {
    for dir in ["rebase-merge", "rebase-apply"] {
        if let Ok(path) = git(repo_path, &["rev-parse", "--git-path", dir]) {
            let candidate = Path::new(path.trim());
            let resolved = if candidate.is_absolute() {
                candidate.to_path_buf()
            } else {
                repo_path.join(candidate)
            };
            if resolved.exists() {
                return true;
            }
        }
    }
    false
}

/// Joins a merge/rebase's stdout+stderr into a single tidy blob for the UI.
fn combine_output(stdout: &str, stderr: &str) -> String {
    [stdout.trim_end(), stderr.trim_end()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// A stable, filesystem-safe key for a repo path, so each repo gets its own
/// worktree namespace under the temp dir.
fn repo_key(repo_path: &Path) -> String {
    let mut hash: u64 = 1469598103934665603; // FNV-1a offset basis
    for byte in repo_path.to_string_lossy().as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

fn sanitize_ref(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Root for all gitty-managed worktrees: `<temp>/gitty-worktrees/<repo-key>`.
/// Scratch space — safe to delete; anything needed is recreated on demand.
fn worktrees_root(repo_path: &Path) -> PathBuf {
    std::env::temp_dir()
        .join("gitty-worktrees")
        .join(repo_key(repo_path))
}

/// Path of the worktree already checked out on `branch`, if git knows one.
fn existing_worktree_for(repo_path: &Path, branch: &str) -> Option<PathBuf> {
    let list = git(repo_path, &["worktree", "list", "--porcelain"]).ok()?;
    let target = format!("refs/heads/{branch}");
    let mut current: Option<PathBuf> = None;
    for line in list.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            current = Some(PathBuf::from(rest.trim()));
        } else if let Some(rest) = line.strip_prefix("branch ") {
            if rest.trim() == target {
                return current.clone();
            }
        }
    }
    None
}

/// Ensures a linked worktree exists with `branch` checked out, reusing the main
/// checkout when it is already on `branch`. Returns the directory to run git in.
/// The result is gitty-managed scratch space; callers may reset its state.
fn ensure_worktree(repo_path: &Path, branch: &str) -> Result<PathBuf, String> {
    if current_branch(repo_path) == branch {
        return Ok(repo_path.to_path_buf());
    }
    if let Some(existing) = existing_worktree_for(repo_path, branch) {
        if existing.exists() {
            return Ok(existing);
        }
    }
    // Clear out git's memory of any worktree dirs we deleted underneath it.
    let _ = git(repo_path, &["worktree", "prune"]);

    let dir = worktrees_root(repo_path).join(sanitize_ref(branch));
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
        let _ = git(repo_path, &["worktree", "prune"]);
    }
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create worktree folder: {err}"))?;
    }
    let dir_str = dir.to_string_lossy().to_string();
    git(repo_path, &["worktree", "add", &dir_str, branch])
        .map_err(|err| format!("Could not prepare a workspace for {branch}.\n{err}"))?;
    Ok(dir)
}

/// Whether `path` lives under our scratch worktree namespace. Matches on the
/// `gitty-worktrees` path component rather than an exact temp-dir prefix so it
/// still recognizes a canonicalized path (macOS resolves the temp dir's
/// `/var` symlink to `/private/var`, which a prefix check would miss).
fn is_gitty_worktree(path: &Path) -> bool {
    path.components()
        .any(|part| part.as_os_str() == "gitty-worktrees")
}

/// The primary (non-linked) working tree of the repo `repo_path` belongs to,
/// even when `repo_path` is itself a linked worktree. The first entry of
/// `git worktree list --porcelain` is always the main checkout.
fn main_worktree(repo_path: &Path) -> Option<PathBuf> {
    let list = git(repo_path, &["worktree", "list", "--porcelain"]).ok()?;
    list.lines()
        .find_map(|line| line.strip_prefix("worktree ").map(|rest| PathBuf::from(rest.trim())))
}

/// Tears down a gitty-managed linked worktree once the operation that borrowed
/// it has finished, freeing the branch it held so the user can check it out in
/// their own checkout again. Safe no-op for the primary checkout or any path
/// outside our scratch root — we only delete space we created. Runs from the
/// primary checkout so pruning still works after the directory is gone.
fn discard_worktree(worktree: &Path) {
    if !is_gitty_worktree(worktree) {
        return;
    }
    let admin = main_worktree(worktree).unwrap_or_else(|| worktree.to_path_buf());
    let wt_str = worktree.to_string_lossy().to_string();
    let _ = git(&admin, &["worktree", "remove", "--force", &wt_str]);
    if worktree.exists() {
        let _ = fs::remove_dir_all(worktree);
    }
    let _ = git(&admin, &["worktree", "prune"]);
}

/// The most recently active branch other than the current one and the trunk,
/// included only when its tip commit is strictly newer than the trunk's tip so
/// the timeline never lights up for a stale branch.
fn sibling_tip(
    repo_path: &Path,
    branch: &str,
    branches: &[BranchEntry],
    trunk: &Option<String>,
) -> Option<SiblingTip> {
    let trunk_date = trunk.as_ref().and_then(|t| {
        branches
            .iter()
            .find(|b| !b.is_remote && &b.name == t)
            .and_then(|b| b.last_commit_date.clone())
    });

    // branch_list is already sorted newest-first, so the first eligible local
    // branch is the most recently active sibling.
    let candidate = branches.iter().find(|b| {
        !b.is_remote
            && b.name != branch
            && Some(&b.name) != trunk.as_ref()
            && b.tip_hash.is_some()
    })?;

    if let (Some(cand_date), Some(trunk_date)) = (&candidate.last_commit_date, &trunk_date) {
        if cand_date <= trunk_date {
            return None;
        }
    }

    let (ahead, behind) = divergence(repo_path, &candidate.name, "HEAD").unwrap_or((0, 0));
    let tip = commit_log_with_args(repo_path, &[&candidate.name, "-n", "1"])
        .into_iter()
        .next()?;

    Some(SiblingTip {
        name: candidate.name.clone(),
        tip,
        ahead,
        behind,
    })
}

/// Predicts whether merging `source` into `target` would conflict, using
/// `git merge-tree` (no working-tree changes). Returns (known, has_conflicts, files).
fn predict_conflicts(repo_path: &Path, target: &str, source: &str) -> (bool, bool, Vec<String>) {
    let Ok((success, stdout, _stderr)) = git_raw(
        repo_path,
        &["merge-tree", "--write-tree", "--name-only", target, source],
    ) else {
        return (false, false, Vec::new());
    };

    if success {
        return (true, false, Vec::new());
    }

    // Conflict output: first line is the tree OID, then conflicted file names
    // until a blank line separates the informational messages.
    let files: Vec<String> = stdout
        .lines()
        .skip(1)
        .take_while(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .collect();

    (true, true, files)
}

fn behind_upstream(repo_path: &Path, branch: &str) -> (bool, u32) {
    let upstream_ref = format!("{branch}@{{u}}");
    if !rev_exists(repo_path, &upstream_ref) {
        return (false, 0);
    }
    let range = format!("{branch}..{upstream_ref}");
    let Ok(output) = git(repo_path, &["rev-list", "--count", &range]) else {
        return (true, 0);
    };
    let count = output.trim().parse::<u32>().unwrap_or(0);
    (true, count)
}

fn merge_analysis_blocking(
    path: String,
    source: String,
    target: String,
) -> Result<MergeAnalysis, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    if source.is_empty() || target.is_empty() {
        return Err("Both a source and target branch are required.".to_string());
    }
    if !rev_exists(&repo_path, &source) {
        return Err(format!("Branch {source} could not be found."));
    }
    if !rev_exists(&repo_path, &target) {
        return Err(format!("Branch {target} could not be found."));
    }

    let current = current_branch(&repo_path);
    let working_tree_clean = changed_files(&repo_path).is_empty();

    // Commits in source that target lacks.
    let range = format!("{target}..{source}");
    let commits = commit_log_with_args(&repo_path, &[&range, "-n", "200"]);
    let already_up_to_date = commits.is_empty();

    // Commits target has that source lacks (source is behind the base).
    let behind_range = format!("{source}..{target}");
    let source_behind = git(&repo_path, &["rev-list", "--count", &behind_range])
        .ok()
        .and_then(|out| out.trim().parse::<u32>().ok())
        .unwrap_or(0);

    // Files the merge would touch (changes on source since the merge base).
    let three_dot = format!("{target}...{source}");
    let files = git(
        &repo_path,
        &["diff", "--name-status", "--find-renames", "-z", &three_dot],
    )
    .map(|output| parse_name_status_z(&output))
    .unwrap_or_default();

    // Fast-forward possible when target is an ancestor of source.
    let fast_forward = !already_up_to_date && is_ancestor(&repo_path, &target, &source);

    let (target_has_upstream, target_behind) = behind_upstream(&repo_path, &target);

    let (conflicts_known, has_conflicts, conflict_files) = if already_up_to_date || fast_forward {
        (true, false, Vec::new())
    } else {
        predict_conflicts(&repo_path, &target, &source)
    };

    Ok(MergeAnalysis {
        source: source.clone(),
        target: target.clone(),
        commits,
        files,
        conflict_files,
        has_conflicts,
        conflicts_known,
        working_tree_clean,
        target_behind,
        target_has_upstream,
        already_up_to_date,
        source_behind,
        fast_forward,
        source_is_current: current == source,
        target_is_current: current == target,
    })
}

#[tauri::command]
async fn merge_analysis(
    path: String,
    source: String,
    target: String,
) -> Result<MergeAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || merge_analysis_blocking(path, source, target))
        .await
        .map_err(|err| format!("Merge analysis failed: {err}"))?
}

/// Merges `source` into `target`. Checks out `target` first if needed. Leaves
/// the repository in a conflicted/merging state when conflicts occur so the
/// caller can drive resolution.
#[tauri::command]
fn merge_execute(
    path: String,
    source: String,
    target: String,
    update_first: Option<bool>,
) -> Result<MergeOutcome, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let source = source.trim().to_string();
    let target = target.trim().to_string();
    if source.is_empty() || target.is_empty() {
        return Err("Both a source and target branch are required.".to_string());
    }
    if source == target {
        return Err("Source and target branch must be different.".to_string());
    }
    if !rev_exists(repo_path, &source) {
        return Err(format!("Branch {source} could not be found."));
    }

    if !changed_files(repo_path).is_empty() {
        return Err("Working tree has uncommitted changes. Commit or stash them first.".to_string());
    }

    // Switch onto the target branch if we are not already there.
    if current_branch(repo_path) != target {
        git(repo_path, &["switch", &target]).or_else(|_| git(repo_path, &["checkout", &target]))?;
    }

    // Optionally bring the target up to date with its upstream first.
    if update_first.unwrap_or(false) && rev_exists(repo_path, &format!("{target}@{{u}}")) {
        let _ = git_raw(repo_path, &["merge", "--ff-only", "@{u}"]);
    }

    let (success, stdout, stderr) =
        git_raw(repo_path, &["merge", "--no-edit", &source])?;
    let output = [stdout.trim_end(), stderr.trim_end()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if success {
        let fast_forwarded = output.contains("Fast-forward");
        return Ok(MergeOutcome {
            status: if fast_forwarded {
                "fast_forward".to_string()
            } else if output.contains("Already up to date") {
                "up_to_date".to_string()
            } else {
                "merged".to_string()
            },
            conflict_files: Vec::new(),
            message: format!("Merged {source} into {target}."),
            output,
            worktree: None,
        });
    }

    let conflict_files = unmerged_files(repo_path);
    if conflict_files.is_empty() {
        // Merge failed for some non-conflict reason; surface it as an error.
        return Err(if output.is_empty() {
            format!("Could not merge {source} into {target}.")
        } else {
            output
        });
    }

    Ok(MergeOutcome {
        status: "conflicts".to_string(),
        message: format!("{} file(s) need conflict resolution.", conflict_files.len()),
        conflict_files,
        output,
        worktree: None,
    })
}

#[tauri::command]
fn merge_status(path: String) -> Result<MergeStatus, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let merging = rev_exists(repo_path, "MERGE_HEAD");
    let conflict_files = if merging {
        unmerged_files(repo_path)
    } else {
        Vec::new()
    };

    // Files staged during the merge that were previously conflicted.
    let resolved_files = if merging {
        git(repo_path, &["diff", "--name-only", "--cached", "--diff-filter=M"])
            .map(|output| {
                output
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(MergeStatus {
        merging,
        branch: current_branch(repo_path),
        conflict_files,
        resolved_files,
    })
}

#[tauri::command]
fn abort_merge(path: String, return_branch: Option<String>) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let output = git(repo_path, &["merge", "--abort"])?;

    if let Some(branch) = return_branch
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty())
    {
        if current_branch(repo_path) != branch && rev_exists(repo_path, &branch) {
            let _ = git(repo_path, &["switch", &branch])
                .or_else(|_| git(repo_path, &["checkout", &branch]));
        }
    }

    // Abandoned merges ran in the scratch worktree; release it so trunk is free
    // to check out again. A no-op when the abort ran in the user's own checkout.
    discard_worktree(repo_path);

    Ok(ActionResult {
        message: "Merge aborted.".to_string(),
        output,
    })
}

/// Resolves a conflicted file by taking one whole side. `side` is "ours"
/// (the target/current branch) or "theirs" (the incoming source branch).
#[tauri::command]
fn resolve_conflict(path: String, file: String, side: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file = file.trim().to_string();
    if file.is_empty() {
        return Err("A file path is required.".to_string());
    }
    let flag = match side.as_str() {
        "ours" => "--ours",
        "theirs" => "--theirs",
        _ => return Err("Side must be \"ours\" or \"theirs\".".to_string()),
    };
    git_owned(
        repo_path,
        vec![
            "checkout".to_string(),
            flag.to_string(),
            "--".to_string(),
            file.clone(),
        ],
    )?;
    let output = git_owned(
        repo_path,
        vec!["add".to_string(), "--".to_string(), file.clone()],
    )?;
    Ok(ActionResult {
        message: format!("Resolved {file}."),
        output,
    })
}

#[tauri::command]
fn conflict_sides(path: String, file: String) -> Result<ConflictSides, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file = file.trim().to_string();
    if file.is_empty() {
        return Err("A file path is required.".to_string());
    }

    let ours = git_owned(repo_path, vec!["show".to_string(), format!(":2:{file}")]);
    let theirs = git_owned(repo_path, vec!["show".to_string(), format!(":3:{file}")]);
    let result = fs::read_to_string(repo_path.join(&file)).unwrap_or_default();

    Ok(ConflictSides {
        ours_exists: ours.is_ok(),
        theirs_exists: theirs.is_ok(),
        ours: ours.unwrap_or_default(),
        theirs: theirs.unwrap_or_default(),
        result,
    })
}

/// Reads a working-tree file as text so the changes view can edit it inline.
#[tauri::command]
fn read_working_file(path: String, file_path: String) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file_path = file_path.trim().to_string();
    if file_path.is_empty() {
        return Err("A file path is required.".to_string());
    }
    let full = repo_path.join(&file_path);
    fs::read_to_string(&full).map_err(|err| format!("Could not read {}: {err}", full.display()))
}

/// Writes new contents to a working-tree file. Does not stage — the edit stays
/// in the working tree so the user keeps control of staging.
#[tauri::command]
fn write_working_file(
    path: String,
    file_path: String,
    content: String,
) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file_path = file_path.trim().to_string();
    if file_path.is_empty() {
        return Err("A file path is required.".to_string());
    }
    let full = repo_path.join(&file_path);
    fs::write(&full, content)
        .map_err(|err| format!("Could not write {}: {err}", full.display()))?;
    Ok(ActionResult {
        message: format!("Saved {file_path}."),
        output: String::new(),
    })
}

/// Writes a manually-resolved file and stages it.
#[tauri::command]
fn resolve_conflict_manual(
    path: String,
    file: String,
    content: String,
) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let file = file.trim().to_string();
    if file.is_empty() {
        return Err("A file path is required.".to_string());
    }
    let full = repo_path.join(&file);
    fs::write(&full, content)
        .map_err(|err| format!("Could not write {}: {err}", full.display()))?;
    let output = git_owned(
        repo_path,
        vec!["add".to_string(), "--".to_string(), file.clone()],
    )?;
    Ok(ActionResult {
        message: format!("Resolved {file}."),
        output,
    })
}

#[tauri::command]
fn complete_merge(path: String, message: Option<String>) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    if !rev_exists(repo_path, "MERGE_HEAD") {
        return Err("No merge is in progress.".to_string());
    }
    let remaining = unmerged_files(repo_path);
    if !remaining.is_empty() {
        return Err(format!(
            "Resolve all conflicts first ({} remaining).",
            remaining.len()
        ));
    }

    let args = match message.map(|m| m.trim().to_string()).filter(|m| !m.is_empty()) {
        Some(msg) => vec!["commit".to_string(), "-m".to_string(), msg],
        None => vec!["commit".to_string(), "--no-edit".to_string()],
    };
    let output = git_owned(repo_path, args)?;
    // Resolution ran inside the scratch worktree; now that the merge is
    // committed, release it so trunk is free to check out again. A no-op when
    // the merge ran in-place (repo_path is the user's own checkout).
    discard_worktree(repo_path);
    Ok(ActionResult {
        message: "Merge completed.".to_string(),
        output,
    })
}

/// Builds an UpdateOutcome from a finished `git rebase` invocation, mapping a
/// paused rebase to a resolvable "conflicts" state.
fn rebase_outcome(
    repo_path: &Path,
    onto: &str,
    success: bool,
    stdout: &str,
    stderr: &str,
) -> Result<UpdateOutcome, String> {
    let output = combine_output(stdout, stderr);
    if success && !rebase_in_progress(repo_path) {
        let up_to_date = output.contains("is up to date");
        return Ok(UpdateOutcome {
            status: if up_to_date { "up_to_date" } else { "updated" }.to_string(),
            conflict_files: Vec::new(),
            message: if up_to_date {
                format!("Already up to date with {onto}.")
            } else {
                format!("Updated onto {onto}.")
            },
            output,
        });
    }

    if rebase_in_progress(repo_path) {
        let conflict_files = unmerged_files(repo_path);
        return Ok(UpdateOutcome {
            status: "conflicts".to_string(),
            message: format!("{} file(s) need conflict resolution.", conflict_files.len()),
            conflict_files,
            output,
        });
    }

    Err(if output.is_empty() {
        format!("Could not update onto {onto}.")
    } else {
        output
    })
}

/// Update the current branch by rebasing it onto `onto` (defaults to the trunk),
/// carrying any uncommitted work across with `--autostash`.
#[tauri::command]
fn update_branch(path: String, onto: Option<String>) -> Result<UpdateOutcome, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    let branch = current_branch(repo_path);
    if is_detached_branch(&branch) {
        return Err("Switch to a branch before updating it.".to_string());
    }

    let onto = onto
        .map(|o| o.trim().to_string())
        .filter(|o| !o.is_empty())
        .or_else(|| integration_branch(&branch_list(repo_path, true)))
        .ok_or_else(|| "No main branch to update from.".to_string())?;

    if onto == branch {
        return Err("A branch can't be updated onto itself.".to_string());
    }
    if !rev_exists(repo_path, &onto) {
        return Err(format!("{onto} could not be found."));
    }

    let (success, stdout, stderr) =
        git_rebase(repo_path, &["rebase", "--autostash", &onto])?;
    rebase_outcome(repo_path, &onto, success, &stdout, &stderr)
}

/// Continue a paused update (rebase) after conflicts have been staged. May pause
/// again on the next conflicting commit, or finish.
#[tauri::command]
fn update_continue(path: String) -> Result<UpdateOutcome, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    if !rebase_in_progress(repo_path) {
        return Err("No update is in progress.".to_string());
    }
    let remaining = unmerged_files(repo_path);
    if !remaining.is_empty() {
        return Err(format!(
            "Resolve all conflicts first ({} remaining).",
            remaining.len()
        ));
    }
    let (success, stdout, stderr) = git_rebase(repo_path, &["rebase", "--continue"])?;
    rebase_outcome(repo_path, "main", success, &stdout, &stderr)
}

/// Abandon a paused update (rebase), restoring the branch to where it started.
#[tauri::command]
fn update_abort(path: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let (_success, stdout, stderr) = git_rebase(repo_path, &["rebase", "--abort"])?;
    Ok(ActionResult {
        message: "Update cancelled.".to_string(),
        output: combine_output(&stdout, &stderr),
    })
}

/// Whether an update (rebase) is paused, and which files still need resolving —
/// so a half-finished update survives an app restart.
#[tauri::command]
fn update_status(path: String) -> Result<UpdateStatus, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let rebasing = rebase_in_progress(repo_path);
    let conflict_files = if rebasing {
        unmerged_files(repo_path)
    } else {
        Vec::new()
    };
    let resolved_files = if rebasing {
        git(repo_path, &["diff", "--name-only", "--cached", "--diff-filter=M"])
            .map(|output| {
                output
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(UpdateStatus {
        rebasing,
        conflict_files,
        resolved_files,
    })
}

/// Builds an UpdateOutcome from a finished `git merge` (the merge-mode pull),
/// mapping a conflicted merge into the same resolvable "conflicts" state a
/// rebase produces, so the UI drives both through one flow.
fn merge_pull_outcome(
    repo_path: &Path,
    upstream_ref: &str,
    success: bool,
    stdout: &str,
    stderr: &str,
) -> Result<UpdateOutcome, String> {
    let output = combine_output(stdout, stderr);
    if success {
        let up_to_date = output.contains("Already up to date");
        return Ok(UpdateOutcome {
            status: if up_to_date { "up_to_date" } else { "updated" }.to_string(),
            conflict_files: Vec::new(),
            message: if up_to_date {
                format!("Already up to date with {upstream_ref}.")
            } else {
                format!("Merged {upstream_ref} into your branch.")
            },
            output,
        });
    }

    let conflict_files = unmerged_files(repo_path);
    if conflict_files.is_empty() {
        return Err(if output.is_empty() {
            format!("Could not pull from {upstream_ref}.")
        } else {
            output
        });
    }
    Ok(UpdateOutcome {
        status: "conflicts".to_string(),
        message: format!("{} file(s) need conflict resolution.", conflict_files.len()),
        conflict_files,
        output,
    })
}

fn pull_repo_blocking(path: String, merge: bool) -> Result<UpdateOutcome, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    let branch = current_branch(repo_path);
    if is_detached_branch(&branch) {
        return Err("Switch to a branch before pulling.".to_string());
    }

    // `@{u}` — the remote-tracking ref this branch pulls from (e.g. origin/main).
    let upstream_ref =
        upstream(repo_path).ok_or_else(|| "This branch has no upstream to pull from.".to_string())?;

    // Refresh the tracking ref for this branch's remote so we reconcile against
    // the remote's latest, not a stale snapshot. The remote name is the first
    // path segment of the upstream ref, falling back to the default remote.
    let remote = upstream_ref
        .split_once('/')
        .map(|(remote, _)| remote.to_string())
        .or_else(|| default_remote_name(repo_path));
    if let Some(remote) = remote.as_deref() {
        git_network_owned(
            repo_path,
            vec!["fetch".to_string(), "--prune".to_string(), remote.to_string()],
        )?;
    }

    if merge {
        // `merge.autoStash` carries uncommitted work across the merge, matching
        // the rebase path's `--autostash`.
        let (success, stdout, stderr) = git_raw(
            repo_path,
            &[
                "-c",
                "merge.autoStash=true",
                "merge",
                "--no-edit",
                &upstream_ref,
            ],
        )?;
        return merge_pull_outcome(repo_path, &upstream_ref, success, &stdout, &stderr);
    }

    // Default: replay local commits on top of the upstream. A branch that's
    // purely behind fast-forwards (no conflicts possible); a diverged branch
    // rebases and may pause on conflicts, resolved through the update flow.
    let (success, stdout, stderr) =
        git_rebase(repo_path, &["rebase", "--autostash", &upstream_ref])?;
    rebase_outcome(repo_path, &upstream_ref, success, &stdout, &stderr)
}

/// Bring the current branch up to date with its upstream: fetch the backing
/// remote, then reconcile. Rebase by default (fast-forward when purely behind);
/// `merge = true` reconciles with a merge commit instead. Conflicts land in the
/// same resolvable state as update-from-main.
#[tauri::command]
async fn pull_repo(path: String, merge: bool) -> Result<UpdateOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || pull_repo_blocking(path, merge))
        .await
        .map_err(|err| format!("Pull task failed: {err}"))?
}

// ---- Linked folders (git subtree) -------------------------------------------

/// Path to a repo's committed linked-folder manifest.
fn subtree_manifest_path(repo_path: &Path) -> PathBuf {
    repo_path.join(".gitty").join("subtrees.json")
}

/// Read the linked-folder manifest, or an empty list when absent/unreadable. The
/// manifest is only a hint cache — a missing or corrupt one is never fatal.
fn read_subtree_manifest(repo_path: &Path) -> Vec<SubtreeManifestEntry> {
    let Ok(data) = fs::read_to_string(subtree_manifest_path(repo_path)) else {
        return Vec::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Write the linked-folder manifest, creating `.gitty/` as needed.
fn write_subtree_manifest(
    repo_path: &Path,
    entries: &[SubtreeManifestEntry],
) -> Result<(), String> {
    let path = subtree_manifest_path(repo_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
    }
    let data = serde_json::to_string_pretty(entries)
        .map_err(|err| format!("Could not serialize linked folders: {err}"))?;
    fs::write(&path, format!("{data}\n"))
        .map_err(|err| format!("Could not write {}: {err}", path.display()))
}

/// Whether this Git build ships the `git subtree` command (a contrib script some
/// minimal installs omit).
fn subtree_available() -> bool {
    Command::new("git")
        .args(["subtree", "-h"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map(|out| {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            !text.contains("is not a git command")
        })
        .unwrap_or(false)
}

fn ensure_subtree_available() -> Result<(), String> {
    if subtree_available() {
        Ok(())
    } else {
        Err("This copy of Git doesn't include subtree support.".to_string())
    }
}

/// Run a `git subtree ...` invocation with editors and prompts disabled, so its
/// internal squash/merge/commit steps never block. Returns (success, stdout,
/// stderr) like the other conflict-aware runners.
fn git_subtree(repo_path: &Path, args: &[&str]) -> Result<(bool, String, String), String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .output()
        .map_err(|err| format!("Could not run git subtree: {err}"))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

/// Reject prefixes that aren't a clean relative path inside the repo.
fn validate_prefix(prefix: &str) -> Result<String, String> {
    let trimmed = prefix.trim().trim_matches('/').to_string();
    if trimmed.is_empty() {
        return Err("Choose a folder for the linked folder.".to_string());
    }
    if Path::new(&trimmed).is_absolute() || trimmed.split('/').any(|part| part == "..") {
        return Err("The folder must be a path inside this repository.".to_string());
    }
    Ok(trimmed)
}

/// Discover the subtree folders recorded in history and the full split SHA each
/// was last synced to, from the `git-subtree-dir:` / `git-subtree-split:`
/// trailers that `--squash` writes onto its squash commits. `git log` is
/// newest-first, so the first split seen per folder is the current one.
fn discover_subtree_prefixes(repo_path: &Path) -> HashMap<String, Option<String>> {
    let mut found: HashMap<String, Option<String>> = HashMap::new();
    let log = match git(
        repo_path,
        &[
            "log",
            "--no-merges",
            "--grep=git-subtree-dir:",
            "--pretty=format:%x1e%b",
        ],
    ) {
        Ok(text) => text,
        Err(_) => return found,
    };

    for record in log.split('\u{1e}') {
        let mut dir: Option<String> = None;
        let mut split: Option<String> = None;
        for line in record.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("git-subtree-dir:") {
                dir = Some(rest.trim().trim_matches('/').to_string());
            } else if let Some(rest) = line.strip_prefix("git-subtree-split:") {
                split = Some(rest.trim().to_string());
            }
        }
        if let Some(dir) = dir.filter(|d| !d.is_empty()) {
            found.entry(dir).or_insert(split);
        }
    }
    found
}

/// A short display SHA (9 chars) from a full one.
fn short_sha(sha: &str) -> String {
    sha.chars().take(9).collect()
}

/// The source ref's current tip SHA via `git ls-remote` — one network round-trip,
/// no fetch, no local refs touched. Prefers an exact `refs/heads/<ref>` match, else
/// the first ref the remote reports for the name (covers a tag or exact ref).
/// `None` on network failure or when the ref isn't found.
fn remote_tip_sha(repo_path: &Path, url: &str, git_ref: &str) -> Option<String> {
    let output = git(repo_path, &["ls-remote", url, git_ref]).ok()?;
    let head_ref = format!("refs/heads/{git_ref}");
    let mut fallback: Option<String> = None;
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let sha = match parts.next() {
            Some(sha) if !sha.is_empty() => sha,
            _ => continue,
        };
        if parts.next().unwrap_or("") == head_ref {
            return Some(sha.to_string());
        }
        if fallback.is_none() {
            fallback = Some(sha.to_string());
        }
    }
    fallback
}

/// Infer a subtree's origin from configured remotes: find a remote-tracking
/// branch that contains the split commit and return that remote's URL + the
/// branch name. Local-only — works whenever the source remote has been fetched,
/// which covers subtrees added from the CLI against a named remote.
fn infer_subtree_source(repo_path: &Path, split_sha: &str) -> Option<(String, String)> {
    if split_sha.is_empty() {
        return None;
    }
    let remotes = remote_list(repo_path);
    if remotes.is_empty() {
        return None;
    }
    // Prefer the fetch URL for a remote when both fetch/push rows are present.
    let url_for = |name: &str| -> Option<String> {
        remotes
            .iter()
            .find(|remote| remote.name == name && remote.kind == "fetch")
            .or_else(|| remotes.iter().find(|remote| remote.name == name))
            .map(|remote| remote.url.clone())
            .filter(|url| !url.is_empty())
    };

    let listing = git(repo_path, &["branch", "-r", "--contains", split_sha]).ok()?;
    for raw in listing.lines() {
        let line = raw.trim();
        if line.is_empty() || line.contains("->") {
            continue;
        }
        // Match the longest remote-name prefix so a branch that itself contains
        // slashes still resolves (remote "origin", branch "feature/x").
        for remote in &remotes {
            let needle = format!("{}/", remote.name);
            if let Some(branch) = line.strip_prefix(&needle) {
                if let Some(url) = url_for(&remote.name) {
                    return Some((url, branch.to_string()));
                }
            }
        }
    }
    None
}

/// Every split SHA ever recorded for a prefix, newest-first, deduped. Used as a
/// fallback when the newest split isn't in a fetched remote (e.g. after a push
/// advanced the source past the last locally-recorded sync point): an older
/// split that a remote-tracking branch still contains resolves the source just
/// as well.
fn all_subtree_splits(repo_path: &Path, prefix: &str) -> Vec<String> {
    let log = match git(
        repo_path,
        &[
            "log",
            "--no-merges",
            "--grep=git-subtree-dir:",
            "--pretty=format:%x1e%b",
        ],
    ) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    let mut splits = Vec::new();
    let mut seen = HashSet::new();
    for record in log.split('\u{1e}') {
        let mut dir: Option<String> = None;
        let mut split: Option<String> = None;
        for line in record.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("git-subtree-dir:") {
                dir = Some(rest.trim().trim_matches('/').to_string());
            } else if let Some(rest) = line.strip_prefix("git-subtree-split:") {
                split = Some(rest.trim().to_string());
            }
        }
        if dir.as_deref() == Some(prefix) {
            if let Some(s) = split.filter(|s| !s.is_empty()) {
                if seen.insert(s.clone()) {
                    splits.push(s);
                }
            }
        }
    }
    splits
}

/// Resolve a folder's source URL + branch: the manifest hint if present, else
/// inferred from remotes via a recorded split commit. Tries the newest split
/// first, then falls back through older ones (the newest may not be in a fetched
/// remote). Returns `(url, branch, from_manifest)`. `None` when truly unknown.
fn resolve_subtree_source(
    repo_path: &Path,
    prefix: &str,
    split_sha: Option<&str>,
    manifest: &[SubtreeManifestEntry],
) -> Option<(String, String, bool)> {
    if let Some(entry) = manifest.iter().find(|entry| entry.folder == prefix) {
        return Some((entry.url.clone(), entry.branch.clone(), true));
    }
    if let Some(split) = split_sha {
        if let Some((url, branch)) = infer_subtree_source(repo_path, split) {
            return Some((url, branch, false));
        }
    }
    for split in all_subtree_splits(repo_path, prefix) {
        if Some(split.as_str()) == split_sha {
            continue;
        }
        if let Some((url, branch)) = infer_subtree_source(repo_path, &split) {
            return Some((url, branch, false));
        }
    }
    None
}

/// List this repo's linked folders, merging what history records with the
/// committed manifest's origin hints. Local-only and instant — no network,
/// matching Gitty's no-background-polling stance; Update fetches on demand.
#[tauri::command]
fn list_linked_folders(path: String) -> Result<Vec<LinkedFolder>, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    let manifest = read_subtree_manifest(repo_path);
    let discovered = discover_subtree_prefixes(repo_path);

    // Union of folders known to history and folders named in the manifest.
    let mut prefixes: Vec<String> = discovered.keys().cloned().collect();
    for entry in &manifest {
        prefixes.push(entry.folder.clone());
    }
    prefixes.sort();
    prefixes.dedup();

    let folders = prefixes
        .into_iter()
        // Only live folders. History keeps a removed subtree's old squash commits
        // forever, so without this a deleted folder would haunt the list; gating on
        // presence means removing the files (staged `git rm`) drops it cleanly.
        .filter(|prefix| repo_path.join(prefix).exists())
        .map(|prefix| {
            let split = discovered.get(&prefix).cloned().flatten();
            let source = resolve_subtree_source(repo_path, &prefix, split.as_deref(), &manifest);
            let dirty = git(repo_path, &["status", "--porcelain", "--", &prefix])
                .map(|out| !out.trim().is_empty())
                .unwrap_or(false);
            let (url, branch, known_source) = match source {
                Some((url, branch, _)) => (url, branch, true),
                None => (String::new(), String::new(), false),
            };
            LinkedFolder {
                last_synced_short: split.as_deref().map(short_sha),
                url,
                branch,
                known_source,
                dirty,
                prefix,
            }
        })
        .collect();

    Ok(folders)
}

/// Check each linked folder against its source ref's current tip
/// (`git ls-remote`, one round-trip per folder, no fetch). Network-bound, so it's
/// deliberately split from the instant `list_linked_folders` and called on demand
/// — when the settings drawer opens and on manual refresh — keeping the list
/// itself offline. A folder with an unknown source or no recorded sync point, or
/// one the network can't reach, comes back `updates_available: None` (neutral).
#[tauri::command]
fn check_subtree_updates(path: String) -> Result<Vec<SubtreeUpdateStatus>, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    let manifest = read_subtree_manifest(repo_path);
    let discovered = discover_subtree_prefixes(repo_path);

    let mut prefixes: Vec<String> = discovered.keys().cloned().collect();
    for entry in &manifest {
        prefixes.push(entry.folder.clone());
    }
    prefixes.sort();
    prefixes.dedup();

    let statuses = prefixes
        .into_iter()
        .filter(|prefix| repo_path.join(prefix).exists())
        .map(|prefix| {
            let split = discovered.get(&prefix).cloned().flatten();
            let source = resolve_subtree_source(repo_path, &prefix, split.as_deref(), &manifest);
            let updates_available = match (split, source) {
                (Some(split), Some((url, branch, _))) if !url.is_empty() && !branch.is_empty() => {
                    remote_tip_sha(repo_path, &url, &branch).map(|tip| tip != split)
                }
                _ => None,
            };
            SubtreeUpdateStatus {
                prefix,
                updates_available,
            }
        })
        .collect();

    Ok(statuses)
}

/// The configured remote whose URL matches a source, if any.
fn remote_name_for_url(repo_path: &Path, url: &str) -> Option<String> {
    remote_list(repo_path)
        .into_iter()
        .find(|remote| remote.url == url)
        .map(|remote| remote.name)
}

/// Tree SHA of a linked folder's content at HEAD.
fn prefix_tree_at_head(repo_path: &Path, prefix: &str) -> Option<String> {
    git(repo_path, &["rev-parse", &format!("HEAD:{prefix}")])
        .ok()
        .map(|sha| sha.trim().to_string())
        .filter(|sha| !sha.is_empty())
}

/// Tip tree of the source's remote-tracking ref (`<remote>/<branch>`), or None
/// when that remote hasn't been fetched. Local-only, no network.
fn tracking_tip_tree(repo_path: &Path, url: &str, branch: &str) -> Option<String> {
    let remote = remote_name_for_url(repo_path, url)?;
    git(
        repo_path,
        &["rev-parse", &format!("{remote}/{branch}^{{tree}}")],
    )
    .ok()
    .map(|sha| sha.trim().to_string())
    .filter(|sha| !sha.is_empty())
}

/// Which linked folders have local content their source doesn't have yet (so
/// Publish has work). Content comparison — the folder's tree vs the source's
/// last-fetched tip tree — because the split-SHA trailer goes stale after a
/// push. Instant/local; freshness of "behind" edge cases follows the last fetch.
#[tauri::command]
fn check_subtree_publishable(path: String) -> Result<Vec<SubtreePublishStatus>, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    let manifest = read_subtree_manifest(repo_path);
    let discovered = discover_subtree_prefixes(repo_path);

    let mut prefixes: Vec<String> = discovered.keys().cloned().collect();
    for entry in &manifest {
        prefixes.push(entry.folder.clone());
    }
    prefixes.sort();
    prefixes.dedup();

    let statuses = prefixes
        .into_iter()
        .filter(|prefix| repo_path.join(prefix).exists())
        .map(|prefix| {
            let split = discovered.get(&prefix).cloned().flatten();
            let source = resolve_subtree_source(repo_path, &prefix, split.as_deref(), &manifest);
            let publishable = match source {
                Some((url, branch, _)) if !url.is_empty() && !branch.is_empty() => {
                    match (
                        prefix_tree_at_head(repo_path, &prefix),
                        tracking_tip_tree(repo_path, &url, &branch),
                    ) {
                        (Some(local), Some(remote)) => Some(local != remote),
                        _ => None,
                    }
                }
                _ => None,
            };
            SubtreePublishStatus { prefix, publishable }
        })
        .collect();

    Ok(statuses)
}

/// Add a folder that mirrors another repo (`git subtree add --squash`), then
/// record its origin in the manifest so Update is one click later.
#[tauri::command]
fn add_linked_folder(
    path: String,
    prefix: String,
    url: String,
    branch: String,
) -> Result<ActionResult, String> {
    ensure_subtree_available()?;
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    let prefix = validate_prefix(&prefix)?;
    let url = url.trim().to_string();
    let branch = branch.trim().to_string();
    if url.is_empty() {
        return Err("Enter the source repository URL.".to_string());
    }
    if branch.is_empty() {
        return Err("Enter the source branch to track.".to_string());
    }
    if repo_path.join(&prefix).exists() {
        return Err(format!(
            "{prefix} already exists. Choose a folder that doesn't exist yet."
        ));
    }

    let (success, stdout, stderr) = git_subtree(
        repo_path,
        &["subtree", "add", "--prefix", &prefix, &url, &branch, "--squash"],
    )?;
    let output = combine_output(&stdout, &stderr);
    if !success {
        return Err(if output.is_empty() {
            format!("Could not add {prefix}.")
        } else {
            output
        });
    }

    // Record the origin. This lands as an uncommitted change to
    // `.gitty/subtrees.json`, which the user commits through the normal flow so
    // teammates inherit the mapping.
    let mut manifest = read_subtree_manifest(repo_path);
    manifest.retain(|entry| entry.folder != prefix);
    manifest.push(SubtreeManifestEntry {
        folder: prefix.clone(),
        url,
        branch,
    });
    manifest.sort_by(|a, b| a.folder.cmp(&b.folder));
    write_subtree_manifest(repo_path, &manifest)?;

    Ok(ActionResult {
        message: format!("Linked {prefix}."),
        output,
    })
}

/// Interpret the result of a `git subtree pull --squash`. On divergence the pull
/// leaves a standard merge state (`MERGE_HEAD` + unmerged files), so the existing
/// ConflictResolver / `complete_merge` / `abort_merge` path finishes it unchanged.
fn subtree_pull_outcome(
    repo_path: &Path,
    prefix: &str,
    success: bool,
    stdout: &str,
    stderr: &str,
) -> Result<UpdateOutcome, String> {
    let output = combine_output(stdout, stderr);
    let conflict_files = unmerged_files(repo_path);

    if !conflict_files.is_empty() || rev_exists(repo_path, "MERGE_HEAD") {
        return Ok(UpdateOutcome {
            status: "conflicts".to_string(),
            message: format!("{} file(s) need conflict resolution.", conflict_files.len()),
            conflict_files,
            output,
        });
    }

    if success {
        // `git subtree pull` reports a no-op as "Subtree is already at commit …";
        // a plain merge fast-path says "up to date".
        let up_to_date = output.contains("already at commit")
            || output.contains("up to date")
            || output.contains("up-to-date");
        return Ok(UpdateOutcome {
            status: if up_to_date { "up_to_date" } else { "updated" }.to_string(),
            conflict_files: Vec::new(),
            message: if up_to_date {
                format!("{prefix} is already up to date.")
            } else {
                format!("Updated {prefix}.")
            },
            output,
        });
    }

    Err(if output.is_empty() {
        format!("Could not update {prefix}.")
    } else {
        output
    })
}

/// Pull the source repo's latest work into a linked folder
/// (`git subtree pull --squash`). Needs a clean tree (a subtree pull is a merge
/// and can't autostash); conflicts flow to the shared resolver.
#[tauri::command]
fn update_linked_folder(path: String, prefix: String) -> Result<UpdateOutcome, String> {
    ensure_subtree_available()?;
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let prefix = validate_prefix(&prefix)?;

    let manifest = read_subtree_manifest(repo_path);
    let split = discover_subtree_prefixes(repo_path)
        .get(&prefix)
        .cloned()
        .flatten();
    let (url, branch, _from_manifest) =
        resolve_subtree_source(repo_path, &prefix, split.as_deref(), &manifest).ok_or_else(|| {
            "Gitty doesn't know where this folder came from. Set its source first.".to_string()
        })?;

    let dirty = git(repo_path, &["status", "--porcelain"])
        .map(|out| !out.trim().is_empty())
        .unwrap_or(false);
    if dirty {
        return Err("Save or set aside your changes before updating a linked folder.".to_string());
    }

    let (success, stdout, stderr) = git_subtree(
        repo_path,
        &["subtree", "pull", "--prefix", &prefix, &url, &branch, "--squash"],
    )?;
    subtree_pull_outcome(repo_path, &prefix, success, &stdout, &stderr)
}

/// Send a linked folder's committed changes back to its source repo
/// (`git subtree push`). Only *committed* work is sent — subtree push splits
/// history, so uncommitted edits in the folder are silently ignored; we block on
/// that with a clear hint. A rejected push means the source moved on since the
/// last sync, so the fix is Update-then-Publish. No `--squash` on push: it splits
/// the folder's real history so the source repo gets clean per-change commits.
#[tauri::command]
fn push_linked_folder(path: String, prefix: String) -> Result<ActionResult, String> {
    ensure_subtree_available()?;
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let prefix = validate_prefix(&prefix)?;

    let manifest = read_subtree_manifest(repo_path);
    let split = discover_subtree_prefixes(repo_path)
        .get(&prefix)
        .cloned()
        .flatten();
    let (url, branch, _from_manifest) =
        resolve_subtree_source(repo_path, &prefix, split.as_deref(), &manifest).ok_or_else(|| {
            "Gitty doesn't know where this folder came from. Set its source first.".to_string()
        })?;

    // Push only sends committed work; uncommitted edits in the folder would be
    // left behind, which is confusing. Block early with a pointed message.
    let dirty = git(repo_path, &["status", "--porcelain", "--", &prefix])
        .map(|out| !out.trim().is_empty())
        .unwrap_or(false);
    if dirty {
        return Err(format!(
            "{prefix} has uncommitted changes. Commit them first — Publish only sends committed work."
        ));
    }

    let (success, stdout, stderr) = git_subtree(
        repo_path,
        &["subtree", "push", "--prefix", &prefix, &url, &branch],
    )?;
    let output = combine_output(&stdout, &stderr);

    if success {
        // Push moved the source to our content but left refs/remotes untouched;
        // advance the tracking ref so the Publish chip clears right away.
        if let Some(remote) = remote_name_for_url(repo_path, &url) {
            let _ = git_raw(repo_path, &["fetch", "--quiet", &remote, &branch]);
        }
        let up_to_date = output.contains("Everything up-to-date") || output.contains("up to date");
        return Ok(ActionResult {
            message: if up_to_date {
                format!("{branch} already has {prefix}'s changes.")
            } else {
                format!("Published {prefix} to its source.")
            },
            output,
        });
    }

    // The usual failure: the source ref advanced, so the push is non-fast-forward.
    let rejected = output.contains("rejected")
        || output.contains("non-fast-forward")
        || output.contains("fetch first")
        || output.contains("behind");
    Err(if rejected {
        format!("The source moved on since your last sync. Update {prefix} first, then Publish again.")
    } else if output.is_empty() {
        format!("Could not publish {prefix}.")
    } else {
        output
    })
}

/// Manually record (or overwrite) a linked folder's source in the manifest. For
/// folders whose origin Gitty couldn't infer from remotes — e.g. added from a
/// bare URL that no remote-tracking branch covers.
#[tauri::command]
fn set_linked_folder_source(
    path: String,
    prefix: String,
    url: String,
    branch: String,
) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let prefix = validate_prefix(&prefix)?;
    let url = url.trim().to_string();
    let branch = branch.trim().to_string();
    if url.is_empty() {
        return Err("Enter the source repository URL.".to_string());
    }
    if branch.is_empty() {
        return Err("Enter the source branch to track.".to_string());
    }
    if !repo_path.join(&prefix).exists() {
        return Err(format!("{prefix} isn't a folder in this repository."));
    }

    let mut manifest = read_subtree_manifest(repo_path);
    manifest.retain(|entry| entry.folder != prefix);
    manifest.push(SubtreeManifestEntry {
        folder: prefix.clone(),
        url,
        branch,
    });
    manifest.sort_by(|a, b| a.folder.cmp(&b.folder));
    write_subtree_manifest(repo_path, &manifest)?;

    Ok(ActionResult {
        message: format!("Connected {prefix} to its source."),
        output: String::new(),
    })
}

/// Stop tracking a linked folder: always drop its manifest entry. When
/// `delete_files` is set, stage the folder's removal too (the user commits it
/// through the normal flow). History still remembers the folder was linked.
#[tauri::command]
fn remove_linked_folder(
    path: String,
    prefix: String,
    delete_files: bool,
) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let prefix = validate_prefix(&prefix)?;

    let mut manifest = read_subtree_manifest(repo_path);
    let had_entry = manifest.iter().any(|entry| entry.folder == prefix);
    manifest.retain(|entry| entry.folder != prefix);
    if had_entry {
        write_subtree_manifest(repo_path, &manifest)?;
    }

    if delete_files && repo_path.join(&prefix).exists() {
        let (success, stdout, stderr) = git_raw(repo_path, &["rm", "-r", "--", &prefix])?;
        let output = combine_output(&stdout, &stderr);
        if !success {
            return Err(if output.is_empty() {
                format!("Could not remove {prefix}.")
            } else {
                output
            });
        }
        return Ok(ActionResult {
            message: format!("Removed {prefix}. Commit to finish."),
            output,
        });
    }

    Ok(ActionResult {
        message: format!("Unlinked {prefix}."),
        output: String::new(),
    })
}

/// Merge `source` (defaults to the current branch) into the trunk, running the
/// merge inside a linked worktree so the user's own checkout, branch, and
/// uncommitted work are never disturbed. On conflicts, the returned `worktree`
/// path is where resolution happens.
#[tauri::command]
fn merge_into_trunk(path: String, source: Option<String>) -> Result<MergeOutcome, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);

    let trunk = integration_branch(&branch_list(repo_path, true))
        .ok_or_else(|| "No main branch to merge into.".to_string())?;

    let source = source
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| current_branch(repo_path));

    if is_detached_branch(&source) {
        return Err("Switch to a branch before merging it into main.".to_string());
    }
    if source == trunk {
        return Err(format!("{source} is already the main branch."));
    }
    if !rev_exists(repo_path, &source) {
        return Err(format!("Branch {source} could not be found."));
    }

    let worktree = ensure_worktree(repo_path, &trunk)?;
    let wt = worktree.as_path();

    // Start from a clean slate — the trunk worktree is gitty-managed scratch, so
    // clear any half-finished merge left from a previous, abandoned attempt.
    if rev_exists(wt, "MERGE_HEAD") {
        let _ = git(wt, &["merge", "--abort"]);
    }

    let in_place = wt == repo_path;
    let worktree_ref = if in_place {
        None
    } else {
        Some(worktree.to_string_lossy().to_string())
    };

    let (success, stdout, stderr) = git_raw(wt, &["merge", "--no-edit", &source])?;
    let output = combine_output(&stdout, &stderr);

    if success {
        let status = if output.contains("Fast-forward") {
            "fast_forward"
        } else if output.contains("Already up to date") {
            "up_to_date"
        } else {
            "merged"
        };
        // The merge landed on trunk; release the scratch worktree so the branch
        // is free to check out in the user's own repo. Only meaningful when we
        // ran in a linked worktree (not in-place on trunk itself).
        if !in_place {
            discard_worktree(wt);
        }
        return Ok(MergeOutcome {
            status: status.to_string(),
            conflict_files: Vec::new(),
            message: format!("Merged {source} into {trunk}."),
            output,
            worktree: None,
        });
    }

    let conflict_files = unmerged_files(wt);
    if conflict_files.is_empty() {
        return Err(if output.is_empty() {
            format!("Could not merge {source} into {trunk}.")
        } else {
            output
        });
    }

    Ok(MergeOutcome {
        status: "conflicts".to_string(),
        message: format!("{} file(s) need conflict resolution.", conflict_files.len()),
        conflict_files,
        output,
        worktree: worktree_ref,
    })
}

/// One checkout of a repository. The main checkout plus every linked worktree,
/// which is what lets a repository have several branches open at once in
/// different folders.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeEntry {
    path: String,
    /// Short branch name, or `None` when the checkout is detached.
    branch: Option<String>,
    head: String,
    /// The original clone. It cannot be removed while linked worktrees exist.
    is_main: bool,
    /// The checkout the user currently has open in Gitty.
    is_current: bool,
    detached: bool,
    locked: bool,
    /// Git considers the folder gone; `git worktree prune` would drop it.
    prunable: bool,
    /// Lives under Gitty's own scratch namespace (a merge or commit preview),
    /// not something the user created. Hidden from the user's list.
    internal: bool,
}

/// Parses `git worktree list --porcelain`. Blocks are separated by blank lines
/// and the first block is always the main checkout.
fn parse_worktree_list(output: &str, repo_path: &Path) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut current: Option<WorktreeEntry> = None;

    let finish = |entries: &mut Vec<WorktreeEntry>, entry: Option<WorktreeEntry>| {
        if let Some(mut entry) = entry {
            entry.is_main = entries.is_empty();
            entries.push(entry);
        }
    };

    for line in output.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            finish(&mut entries, current.take());
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            finish(&mut entries, current.take());
            let wt_path = rest.trim().to_string();
            let as_path = PathBuf::from(&wt_path);
            current = Some(WorktreeEntry {
                is_current: same_path(&as_path, repo_path),
                internal: is_gitty_worktree(&as_path),
                path: wt_path,
                branch: None,
                head: String::new(),
                is_main: false,
                detached: false,
                locked: false,
                prunable: false,
            });
        } else if let Some(entry) = current.as_mut() {
            if let Some(rest) = line.strip_prefix("HEAD ") {
                entry.head = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("branch ") {
                entry.branch = Some(
                    rest.trim()
                        .strip_prefix("refs/heads/")
                        .unwrap_or(rest.trim())
                        .to_string(),
                );
            } else if line == "detached" {
                entry.detached = true;
            } else if line == "locked" || line.starts_with("locked ") {
                entry.locked = true;
            } else if line == "prunable" || line.starts_with("prunable ") {
                entry.prunable = true;
            }
        }
    }
    finish(&mut entries, current.take());
    entries
}

/// Compares two paths after canonicalising, so `/tmp` and `/private/tmp` (and
/// trailing separators) don't read as different checkouts.
fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => left == right,
    }
}

/// Every checkout of this repository. Gitty's own scratch worktrees are marked
/// `internal` so the UI can leave them out.
#[tauri::command]
fn list_worktrees(path: String) -> Result<Vec<WorktreeEntry>, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let output = git(&repo_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_list(&output, &repo_path))
}

/// Open a branch in its own folder. `create_branch` starts a new branch at the
/// current HEAD instead of checking out an existing one.
#[tauri::command]
fn add_worktree(
    path: String,
    directory: String,
    branch: String,
    create_branch: Option<bool>,
) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let branch = branch.trim().to_string();
    let directory = directory.trim().to_string();
    if branch.is_empty() {
        return Err("Branch name is required.".to_string());
    }
    if directory.is_empty() {
        return Err("Folder is required.".to_string());
    }
    if PathBuf::from(&directory).exists() {
        return Err(format!("{directory} already exists. Choose a folder that doesn't exist yet."));
    }
    writable_ancestor(&PathBuf::from(&directory))?;

    // Clear git's memory of folders deleted from underneath it, so a reused name
    // doesn't fail with a stale registration.
    let _ = git(&repo_path, &["worktree", "prune"]);

    let args: Vec<String> = if create_branch.unwrap_or(false) {
        vec![
            "worktree".into(),
            "add".into(),
            "-b".into(),
            branch.clone(),
            directory.clone(),
        ]
    } else {
        vec![
            "worktree".into(),
            "add".into(),
            directory.clone(),
            branch.clone(),
        ]
    };
    git_owned(&repo_path, args)?;
    Ok(directory)
}

/// Stop tracking a checkout and delete its folder. The main checkout can never
/// be removed this way.
#[tauri::command]
fn remove_worktree(path: String, worktree: String, force: Option<bool>) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let target = PathBuf::from(worktree.trim());

    if let Some(main) = main_worktree(&repo_path) {
        if same_path(&target, &main) {
            return Err("That's the repository's main folder, so it can't be removed here.".to_string());
        }
    }

    let target_str = target.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["worktree".into(), "remove".into()];
    if force.unwrap_or(false) {
        args.push("--force".into());
    }
    args.push(target_str.clone());

    let output = git_owned(&repo_path, args)?;
    Ok(ActionResult {
        message: format!("Removed {target_str}"),
        output,
    })
}

/// Drop registrations for folders that no longer exist on disk.
#[tauri::command]
fn prune_worktrees(path: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = PathBuf::from(&repo.path);
    let output = git(&repo_path, &["worktree", "prune", "-v"])?;
    Ok(ActionResult {
        message: "Cleaned up folders git could no longer find.".to_string(),
        output,
    })
}

/// Check `commit` out into a throwaway worktree and return its path, so the user
/// can browse an old version on disk without detaching HEAD or touching their
/// working tree. Replaces the old "time travel" checkout.
#[tauri::command]
fn open_commit_worktree(path: String, commit: String) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err("A commit is required.".to_string());
    }
    if !rev_exists(repo_path, &commit) {
        return Err("That commit could not be found.".to_string());
    }

    let short = git(repo_path, &["rev-parse", "--short", &commit])
        .unwrap_or_else(|_| sanitize_ref(&commit));
    let dir = worktrees_root(repo_path).join(format!("commit-{}", sanitize_ref(&short)));
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    let _ = git(repo_path, &["worktree", "prune"]);
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create worktree folder: {err}"))?;
    }
    let dir_str = dir.to_string_lossy().to_string();
    git(repo_path, &["worktree", "add", "--detach", &dir_str, &commit])
        .map_err(|err| format!("Could not open that version.\n{err}"))?;
    Ok(dir_str)
}

/// Remove all throwaway commit worktrees created by `open_commit_worktree`.
#[tauri::command]
fn cleanup_commit_worktrees(path: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let root = worktrees_root(repo_path);
    let mut removed = 0;
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with("commit-") {
                if fs::remove_dir_all(entry.path()).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    let _ = git(repo_path, &["worktree", "prune"]);
    Ok(ActionResult {
        message: format!("Cleaned up {removed} version workspace(s)."),
        output: String::new(),
    })
}

#[tauri::command]
fn stage_files(path: String, files: Vec<String>, stage: bool) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    if files.is_empty() {
        return Err("Select at least one file.".to_string());
    }

    let staged_changes = if stage {
        HashMap::new()
    } else {
        changed_files(repo_path)
            .into_iter()
            .filter(|change| {
                let index_status = change.status.as_bytes().first().copied().unwrap_or(b' ');
                index_status != b' ' && index_status != b'?'
            })
            .map(|change| (change.path, change.old_path))
            .collect::<HashMap<_, _>>()
    };

    let mut valid_files = Vec::new();
    for file in files {
        if file.is_empty() {
            continue;
        }
        if stage {
            let full_path = repo_path.join(&file);
            let tracked = git_owned(
                repo_path,
                vec!["ls-files".to_string(), "--error-unmatch".to_string(), "--".to_string(), file.clone()],
            ).is_ok();
            if full_path.exists() || tracked {
                valid_files.push(file);
            }
        } else if let Some(old_path) = staged_changes.get(&file) {
            valid_files.push(file);
            // Git represents a staged rename as an index entry for the new
            // path. Restoring only that path leaves its old path staged as a
            // deletion, so restore both sides of the rename together.
            if let Some(old_path) = old_path {
                valid_files.push(old_path.clone());
            }
        }
    }

    if valid_files.is_empty() {
        return Ok(ActionResult {
            message: if stage {
                "No remaining valid files to stage.".to_string()
            } else {
                "No remaining valid files to unstage.".to_string()
            },
            output: String::new(),
        });
    }

    let mut args = if stage {
        vec!["add".to_string(), "--".to_string()]
    } else {
        vec!["restore".to_string(), "--staged".to_string(), "--".to_string()]
    };
    args.extend(valid_files);
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
    add_repo(app, path_buf.to_string_lossy().to_string())
}

#[tauri::command]
async fn fetch_repo(path: String) -> Result<ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = normalize_repo(&path)?;
        let repo_path = Path::new(&repo.path);
        let remote = default_remote_name(repo_path)
            .ok_or_else(|| "Add a primary remote before fetching.".to_string())?;
        // Extra remotes are backup destinations. Fetching only the primary keeps a
        // backup from becoming an accidental source of branch state or merges.
        let output = git_network_owned(
            repo_path,
            vec!["fetch".to_string(), "--prune".to_string(), remote.clone()],
        )?;
        Ok(ActionResult {
            message: format!("Fetched {remote}."),
            output,
        })
    })
    .await
    .map_err(|err| format!("Fetch task failed: {err}"))?
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

fn push_tags(
    app: &AppHandle,
    repo_path: &Path,
    remote: &str,
    tags: &[String],
) -> Result<String, String> {
    if tags.is_empty() {
        return Ok(String::new());
    }

    let mut args = vec!["push".to_string(), remote.to_string()];
    args.extend(tags.iter().cloned());
    let phase = format!("Pushing tags to {remote}");
    emit_git_progress(app, &repo_path.to_string_lossy(), phase.clone(), "Starting…");
    git_network_owned_with_progress(app, repo_path, args, &phase)
}

/// Replicate the current branch and/or freshly-pushed tags to one backup
/// remote. This deliberately does not set an upstream: backups are write-only
/// copies, while the primary remains the only tracking remote.
fn push_backup(
    app: &AppHandle,
    repo_path: &Path,
    remote: &str,
    branch: Option<&str>,
    tags: &[String],
    force: bool,
    hard: bool,
) -> Result<String, String> {
    let mut args = vec!["push".to_string()];
    if hard {
        args.push("--force".to_string());
    } else if force {
        args.push("--force-with-lease".to_string());
    }
    args.push(remote.to_string());
    if let Some(branch) = branch {
        args.push(format!("{branch}:{branch}"));
    }
    args.extend(tags.iter().cloned());
    let phase = format!("Backing up to {remote}");
    emit_git_progress(app, &repo_path.to_string_lossy(), phase.clone(), "Starting…");
    git_network_owned_with_progress(app, repo_path, args, &phase)
}

fn push_repo_blocking(
    app: AppHandle,
    path: String,
    force: bool,
    hard: bool,
    tags: bool,
) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let branch = current_branch(repo_path);
    let remote = default_remote_name(repo_path);
    if let Some(remote) = remote.as_deref() {
        emit_git_progress(&app, &repo.path, format!("Checking {remote}"), "Checking tags and remote state…");
    }
    let tags_to_push = tags_for_push(repo_path, tags);
    let backup_after_push = backup_on_push(repo_path);
    let retrying_backup = backup_push_pending(repo_path) && backup_after_push;
    let mut outputs = Vec::new();
    let (ahead, behind) = ahead_behind(repo_path, &branch, &upstream(repo_path));
    let forcing = force || hard;
    // A branch that exists only locally still needs pushing to publish it, even
    // with no commits ahead of the remote (`branch_published` returns false only
    // when there's a remote to publish to). The `-u` handling below sets its
    // upstream on this first push.
    let unpushed_branch = !branch_published(repo_path, &branch, &upstream(repo_path));
    let branch_pushed = ahead > 0 || (forcing && behind > 0) || unpushed_branch;

    if branch_pushed {
        let mut args = vec!["push".to_string()];
        // `hard` is the unconditional overwrite (`--force`); `force` is the safe
        // lease. Prefer the lease unless the caller explicitly asked for the
        // hard overwrite — needed when the remote-tracking ref is stale and the
        // lease can't be satisfied ("stale info").
        if hard {
            args.push("--force".to_string());
        } else if force {
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

        let primary = remote.as_deref().unwrap_or("primary");
        let phase = format!("Pushing to {primary}");
        emit_git_progress(&app, &repo.path, phase.clone(), "Starting…");
        outputs.push(git_network_owned_with_progress(&app, repo_path, args, &phase)?);
    }

    if !tags_to_push.is_empty() {
        let remote_name = remote
            .as_deref()
            .ok_or_else(|| "Add a remote before pushing tags.".to_string())?;
        outputs.push(push_tags(&app, repo_path, remote_name, &tags_to_push)?);
    }

    if outputs.is_empty() && !retrying_backup {
        return Err("Nothing to push.".to_string());
    }

    // Backup is a separate action by default. When the repository has opted
    // into "Back up after push", copy to its backup remotes only after the
    // primary push succeeds.
    let primary_name = remote.as_deref().unwrap_or_default();
    let backups = if backup_after_push {
        backup_remote_names(repo_path, primary_name)
    } else {
        Vec::new()
    };
    let backup_branch = (!is_detached_branch(&branch)
        && (branch_pushed || !tags_to_push.is_empty() || retrying_backup))
        .then_some(branch.as_str());
    let mut backed_up = Vec::new();
    let mut backup_failures = Vec::new();
    for backup in backups {
        // Compare each backup independently. This repairs tags that reached the
        // primary before a backup failed, and makes a retry complete rather
        // than merely re-sending the branch.
        //
        // Gated on the same `tags` opt-in as the primary. Without the gate this
        // computed every unpushed tag regardless, so a commits-only push still
        // copied the upstream's whole release history to every backup remote --
        // the exact harm the flag exists to prevent, aimed at a different
        // remote, and it left the backup holding tags the primary does not.
        let backup_tags = backup_tags_for_push(repo_path, &backup, tags);
        if backup_branch.is_none() && backup_tags.is_empty() {
            continue;
        }
        match push_backup(
            &app,
            repo_path,
            &backup,
            backup_branch,
            &backup_tags,
            force,
            hard,
        ) {
            Ok(output) => {
                backed_up.push(backup.clone());
                outputs.push(format!("Backup {backup}:\n{output}"));
            }
            Err(error) => backup_failures.push(format!("{backup}: {error}")),
        }
    }

    if backup_after_push {
        if !backup_failures.is_empty() {
            set_backup_push_pending(repo_path, true);
        } else {
            set_backup_push_pending(repo_path, false);
        }
    }

    let retry_only = retrying_backup && !branch_pushed && tags_to_push.is_empty();
    let tag_count = tags_to_push.len();
    let primary_message = match (branch_pushed, tag_count) {
        (true, 0) if hard => "Force push completed (--force, remote overwritten).".to_string(),
        (true, 0) if force => "Force push completed with --force-with-lease.".to_string(),
        (true, 0) => "Push completed.".to_string(),
        (true, 1) => "Push completed (1 tag pushed).".to_string(),
        (true, count) => format!("Push completed ({count} tags pushed)."),
        (false, 1) => "Pushed 1 tag.".to_string(),
        (false, count) => format!("Pushed {count} tags."),
    };

    let message = if retry_only && backup_failures.is_empty() && backed_up.is_empty() {
        "No backup remotes remain; cleared the backup retry.".to_string()
    } else if retry_only && backup_failures.is_empty() {
        format!("Backup retry completed for {}.", backed_up.join(", "))
    } else if retry_only {
        format!(
            "Backup retry failed for {}. Retry Push to try again.",
            backup_failures
                .iter()
                .map(|failure| failure.split_once(':').map(|(name, _)| name).unwrap_or(failure.as_str()))
                .collect::<Vec<_>>()
                .join(", "),
        )
    } else if backup_failures.is_empty() && backed_up.is_empty() {
        primary_message
    } else if backup_failures.is_empty() {
        format!("{primary_message} Backed up to {}.", backed_up.join(", "))
    } else {
        format!(
            "{primary_message} Backup failed for {}. Retry Push to try again.",
            backup_failures
                .iter()
                .map(|failure| failure.split_once(':').map(|(name, _)| name).unwrap_or(failure.as_str()))
                .collect::<Vec<_>>()
                .join(", "),
        )
    };

    if !backup_failures.is_empty() {
        outputs.push(format!("Backup failures:\n{}", backup_failures.join("\n")));
    }

    Ok(ActionResult {
        message,
        output: outputs.join("\n\n"),
    })
}

/// Copy every local branch and tag to every backup remote without touching the
/// primary remote. This is the explicit Backup action.
fn backup_repo_blocking(app: AppHandle, path: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let primary = default_remote_name(repo_path).unwrap_or_default();
    let backups = backup_remote_names(repo_path, &primary);
    if backups.is_empty() {
        return Err("Set up a backup remote before backing up this repository.".to_string());
    }

    let mut outputs = Vec::new();
    let mut succeeded = Vec::new();
    let mut failures = Vec::new();

    for backup in backups {
        let phase = format!("Backing up to {backup}");
        emit_git_progress(&app, &repo.path, phase.clone(), "Pushing all local branches…");
        let branches = git_network_owned_with_progress(
            &app,
            repo_path,
            vec!["push".to_string(), backup.clone(), "--all".to_string()],
            &phase,
        );
        match branches {
            Ok(branches) => {
                emit_git_progress(&app, &repo.path, phase.clone(), "Pushing tags…");
                match git_network_owned_with_progress(
                    &app,
                    repo_path,
                    vec!["push".to_string(), backup.clone(), "--tags".to_string()],
                    &phase,
                ) {
                    Ok(tags) => {
                        succeeded.push(backup.clone());
                        outputs.push(format!("Backup {backup}:\n{branches}\n{tags}"));
                    }
                    Err(error) => failures.push(format!("{backup}: {error}")),
                }
            }
            Err(error) => failures.push(format!("{backup}: {error}")),
        }
    }

    set_backup_push_pending(repo_path, !failures.is_empty());
    if !failures.is_empty() && succeeded.is_empty() {
        return Err(format!("Backup failed for {}.", failures.join("\n")));
    }
    if !failures.is_empty() {
        outputs.push(format!("Backup failures:\n{}", failures.join("\n")));
    }
    let message = if failures.is_empty() {
        format!("Backup completed to {}.", succeeded.join(", "))
    } else {
        format!("Backed up to {}. Backup failed for {}.", succeeded.join(", "), failures.join(", "))
    };
    Ok(ActionResult { message, output: outputs.join("\n\n") })
}

#[tauri::command]
async fn backup_repo(app: AppHandle, path: String) -> Result<ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || backup_repo_blocking(app, path))
        .await
        .map_err(|err| format!("Backup task failed: {err}"))?
}

/// `tags` is opt-in and defaults to false.
///
/// Pushing tags alongside commits was silent and unconditional, which is wrong
/// whenever the tags did not originate here. A fork typically carries the
/// upstream's whole release history — tags arrive with a fetch, are never
/// mirrored to the fork by `git push`, and so read as permanently unpushed.
/// Pressing Push then published someone else's releases under your name, in a
/// count the button never said was tags. The caller now has to ask.
#[tauri::command]
async fn push_repo(
    app: AppHandle,
    path: String,
    force: bool,
    hard: bool,
    tags: Option<bool>,
) -> Result<ActionResult, String> {
    let tags = tags.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || push_repo_blocking(app, path, force, hard, tags))
        .await
        .map_err(|err| format!("Push task failed: {err}"))?
}

fn push_branch_blocking(path: String, branch: String, force: bool) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err("A branch is required.".to_string());
    }
    let remote = default_remote_name(repo_path)
        .ok_or_else(|| "Add a remote before pushing.".to_string())?;
    // Push a named local ref regardless of which branch is checked out — refs are
    // shared across worktrees, so this ships `main` even while you sit on a branch.
    let mut args = vec!["push".to_string()];
    if force {
        args.push("--force-with-lease".to_string());
    }
    args.push(remote.clone());
    args.push(format!("{branch}:{branch}"));
    let output = git_network_owned(repo_path, args)?;
    Ok(ActionResult {
        message: format!("Pushed {branch} to {remote}."),
        output,
    })
}

/// Push a specific local branch to its remote, from any checkout. Used to ship
/// `main` after a merge-into-trunk without switching onto it.
#[tauri::command]
async fn push_branch(path: String, branch: String, force: bool) -> Result<ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || push_branch_blocking(path, branch, force))
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
fn rev_parse_head(path: String) -> Result<String, String> {
    let repo = normalize_repo(&path)?;
    git(Path::new(&repo.path), &["rev-parse", "HEAD"])
}

#[tauri::command]
fn stash_push(path: String, message: Option<String>) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let message = message
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "gitty-visit".to_string());
    let output = git(repo_path, &["stash", "push", "-u", "-m", &message])?;
    Ok(ActionResult {
        message: "Changes stashed.".to_string(),
        output,
    })
}

#[tauri::command]
fn stash_pop(path: String) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let output = git(Path::new(&repo.path), &["stash", "pop"])?;
    Ok(ActionResult {
        message: "Stashed changes restored.".to_string(),
        output,
    })
}

#[tauri::command]
fn discard_files(path: String, files: Vec<String>) -> Result<ActionResult, String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    if files.is_empty() {
        return Err("Select at least one file.".to_string());
    }

    let changes = changed_files(repo_path);
    let mut untracked = Vec::new();
    let mut tracked = Vec::new();

    for file in files {
        let file = file.trim().to_string();
        if file.is_empty() {
            continue;
        }
        let change = changes.iter().find(|change| change.path == file);
        if let Some(change) = change {
            if change.status.starts_with('?') {
                untracked.push(file);
            } else {
                tracked.push(file);
            }
        }
    }

    if tracked.is_empty() && untracked.is_empty() {
        return Err("No matching changed files to discard.".to_string());
    }

    let count = tracked.len() + untracked.len();
    let mut outputs = Vec::new();
    if !tracked.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--staged".to_string(),
            "--worktree".to_string(),
            "--".to_string(),
        ];
        args.extend(tracked);
        outputs.push(git_owned(repo_path, args)?);
    }
    if !untracked.is_empty() {
        let mut args = vec!["clean".to_string(), "-fd".to_string(), "--".to_string()];
        args.extend(untracked);
        outputs.push(git_owned(repo_path, args)?);
    }

    Ok(ActionResult {
        message: format!(
            "Discarded changes in {} {}.",
            count,
            if count == 1 { "file" } else { "files" }
        ),
        output: outputs.join("\n\n"),
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
fn set_fetch_on_refresh(app: AppHandle, enabled: bool) -> Result<settings::AppSettingsView, String> {
    let mut current = settings::load_settings(&app)?;
    current.fetch_on_refresh = enabled;
    settings::save_settings(&app, &current)?;
    settings::settings_view(&app)
}

#[tauri::command]
fn set_push_on_commit(app: AppHandle, enabled: bool) -> Result<settings::AppSettingsView, String> {
    let mut current = settings::load_settings(&app)?;
    current.push_on_commit = enabled;
    settings::save_settings(&app, &current)?;
    settings::settings_view(&app)
}

fn validate_backup_profile(remote_name: &str, url_template: &str) -> Result<(String, String), String> {
    let remote_name = remote_name.trim().to_string();
    let url_template = url_template.trim().trim_end_matches('/').to_string();
    if remote_name.is_empty()
        || remote_name.starts_with('-')
        || !remote_name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("Use a remote name made of letters, numbers, dots, dashes, or underscores.".to_string());
    }
    if url_template.is_empty() || !url_template.contains("{repo}") || url_template.contains(char::is_whitespace) {
        return Err("The backup URL template must contain {repo}, for example https://git.example.com/alice/{repo}.git.".to_string());
    }
    Ok((remote_name, url_template))
}

#[tauri::command]
fn set_backup_profile(
    app: AppHandle,
    remote_name: String,
    url_template: String,
) -> Result<settings::AppSettingsView, String> {
    let (remote_name, url_template) = validate_backup_profile(&remote_name, &url_template)?;
    let mut current = settings::load_settings(&app)?;
    current.backup_remote_name = Some(remote_name);
    current.backup_url_template = Some(url_template);
    settings::save_settings(&app, &current)?;
    settings::settings_view(&app)
}

fn backup_repo_slug(repo: &RepoEntry) -> Result<&str, String> {
    let slug = repo.name.trim();
    if slug.is_empty()
        || !slug
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("its folder name cannot be used safely in a remote URL".to_string());
    }
    Ok(slug)
}

fn git_urls_equal(a: &str, b: &str) -> bool {
    let normalize = |u: &str| {
        let trimmed = u.trim().trim_end_matches('/');
        trimmed
            .strip_suffix(".git")
            .unwrap_or(trimmed)
            .to_lowercase()
    };
    normalize(a) == normalize(b)
}

/// Set up one repository's backup when the user opens that repository. A
/// manual remote is never overwritten, and the initial sync copies every local
/// branch and tag so the backup starts complete rather than at just HEAD.
fn configure_backup_remote_blocking(
    app: AppHandle,
    path: String,
    remote_name: String,
    url_template: String,
) -> Result<BackupSetupResult, String> {
    let (remote_name, url_template) = validate_backup_profile(&remote_name, &url_template)?;
    let repo = normalize_repo(&path)?;
    let slug = backup_repo_slug(&repo)?;
    let url = url_template.replace("{repo}", slug);
    let repo_path = Path::new(&repo.path);
    let remotes = git(repo_path, &["remote"])?;

    if remotes.lines().any(|name| name == remote_name) {
        let existing = git(repo_path, &["remote", "get-url", &remote_name])?;
        if !git_urls_equal(&existing, &url) {
            return Err(format!(
                "{} already points to {}. Gitty will not overwrite an existing backup remote.",
                remote_name,
                existing.trim()
            ));
        }
    } else {
        git_owned(
            repo_path,
            vec![
                "remote".to_string(),
                "add".to_string(),
                remote_name.clone(),
                url.clone(),
            ],
        )?;
    }

    let phase = format!("Setting up backup {remote_name}");
    emit_git_progress(&app, &repo.path, phase.clone(), "Pushing all local branches…");
    let branches = git_network_owned_with_progress(
        &app,
        repo_path,
        vec!["push".to_string(), remote_name.clone(), "--all".to_string()],
        &phase,
    );
    let (message, output, synced) = match branches {
        Ok(branches) => {
            emit_git_progress(&app, &repo.path, phase.clone(), "Pushing tags…");
            match git_network_owned_with_progress(
            &app,
            repo_path,
            vec!["push".to_string(), remote_name.clone(), "--tags".to_string()],
            &phase,
        ) {
            Ok(tags) => (
                format!("Backup {remote_name} configured and synced."),
                format!("{branches}\n{tags}"),
                true,
            ),
            Err(error) => (
                format!("Backup {remote_name} was configured, but its initial sync failed."),
                error,
                false,
            ),
            }
        }
        Err(error) => (
            format!("Backup {remote_name} was configured, but its initial sync failed."),
            error,
            false,
        ),
    };
    set_backup_push_pending(repo_path, !synced);
    Ok(BackupSetupResult {
        message,
        output,
        synced,
    })
}

#[tauri::command]
async fn configure_backup_remote(
    app: AppHandle,
    path: String,
    remote_name: String,
    url_template: String,
) -> Result<BackupSetupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        configure_backup_remote_blocking(app, path, remote_name, url_template)
    })
    .await
    .map_err(|err| format!("Backup setup task failed: {err}"))?
}

#[tauri::command]
fn set_backup_on_push(path: String, enabled: bool) -> Result<(), String> {
    let repo = normalize_repo(&path)?;
    let repo_path = Path::new(&repo.path);
    let primary = default_remote_name(repo_path).unwrap_or_default();
    if enabled && backup_remote_names(repo_path, &primary).is_empty() {
        return Err("Set up a backup remote before enabling backup after push.".to_string());
    }
    write_backup_on_push(repo_path, enabled)
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
            runner::detect_repo_actions,
            runner::execute_repo_action,
            init_repo,
            list_repos,
            resolve_repo_icon,
            list_repo_images,
            set_repo_icon,
            clear_repo_icon,
            add_repo,
            remove_repo,
            reorder_repos,
            start_repo_discovery,
            repo_snapshot,
            repo_enrich,
            repo_commits,
            repo_changes,
            repo_focus_state,
            commit_files_command,
            commit_diff,
            file_diff,
            file_diff_parts,
            stage_hunk,
            unstage_hunk,
            discard_hunk,
            file_image_preview,
            checkout_branch,
            create_branch,
            merge_branch,
            merge_analysis,
            merge_execute,
            merge_into_trunk,
            update_branch,
            update_continue,
            update_abort,
            update_status,
            pull_repo,
            list_linked_folders,
            check_subtree_updates,
            check_subtree_publishable,
            add_linked_folder,
            update_linked_folder,
            push_linked_folder,
            set_linked_folder_source,
            remove_linked_folder,
            open_commit_worktree,
            cleanup_commit_worktrees,
            list_worktrees,
            add_worktree,
            remove_worktree,
            prune_worktrees,
            merge_status,
            abort_merge,
            resolve_conflict,
            resolve_conflict_manual,
            read_working_file,
            write_working_file,
            conflict_sides,
            complete_merge,
            stage_files,
            stage_all,
            commit_repo,
            head_commit_message,
            commit_message,
            fetch_repo,
            remove_remote,
            push_repo,
            backup_repo,
            push_branch,
            create_tag,
            delete_tag,
            discard_files,
            reset_working_tree,
            rev_parse_head,
            stash_push,
            stash_pop,
            reset_to_commit,
            set_remote,
            get_app_settings,
            set_auto_summarize_enabled,
            set_fetch_on_refresh,
            set_push_on_commit,
            set_backup_profile,
            configure_backup_remote,
            set_backup_on_push,
            set_nvidia_api_key,
            delete_nvidia_api_key,
            test_nvidia_api_key,
            summarize_changes,
            editors::detect_editors,
            editors::open_in_editor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod worktree_tests {
    use super::*;

    const SAMPLE: &str = "\
worktree /repo/main
HEAD aaaa1111
branch refs/heads/main

worktree /repo/feature
HEAD bbbb2222
branch refs/heads/feature

worktree /repo/detached
HEAD cccc3333
detached

worktree /repo/gone
HEAD dddd4444
branch refs/heads/old
prunable gitdir file points to non-existent location

worktree /repo/held
HEAD eeee5555
branch refs/heads/held
locked under review
";

    #[test]
    fn parses_every_block_shape() {
        let entries = parse_worktree_list(SAMPLE, Path::new("/repo/feature"));
        assert_eq!(entries.len(), 5);

        // First block is always the main checkout.
        assert!(entries[0].is_main);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert!(!entries[1].is_main);

        // refs/heads/ is stripped so the UI can show a plain branch name.
        assert_eq!(entries[1].branch.as_deref(), Some("feature"));

        // Detached checkouts have no branch.
        assert!(entries[2].detached);
        assert_eq!(entries[2].branch, None);

        // Flags carry their trailing reason text without breaking parsing.
        assert!(entries[3].prunable);
        assert!(entries[4].locked);
        assert_eq!(entries[4].branch.as_deref(), Some("held"));

        // HEAD is captured per block.
        assert_eq!(entries[0].head, "aaaa1111");
        assert_eq!(entries[4].head, "eeee5555");
    }

    #[test]
    fn marks_only_the_open_checkout_as_current() {
        let entries = parse_worktree_list(SAMPLE, Path::new("/repo/feature"));
        let current: Vec<&str> = entries
            .iter()
            .filter(|entry| entry.is_current)
            .map(|entry| entry.path.as_str())
            .collect();
        assert_eq!(current, vec!["/repo/feature"]);
    }

    #[test]
    fn tolerates_trailing_block_without_blank_line() {
        // git omits the trailing newline in some versions; the last block must
        // still be emitted rather than dropped.
        let out = "worktree /only\nHEAD ffff6666\nbranch refs/heads/solo";
        let entries = parse_worktree_list(out, Path::new("/elsewhere"));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].branch.as_deref(), Some("solo"));
        assert!(entries[0].is_main);
        assert!(!entries[0].is_current);
    }

    #[test]
    fn flags_gitty_scratch_worktrees_as_internal() {
        let out = "worktree /tmp/gitty-worktrees/abc/feature\nHEAD 1111\nbranch refs/heads/feature\n";
        let entries = parse_worktree_list(out, Path::new("/repo"));
        assert!(entries[0].internal);
    }

    #[test]
    fn empty_output_yields_no_entries() {
        assert!(parse_worktree_list("", Path::new("/repo")).is_empty());
    }

    // The commands below touch the filesystem: they create folders and delete
    // them. Each runs against its own throwaway repository so they can run in
    // parallel and leave nothing behind.

    fn run_git(dir: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git should run");
        assert!(
            status.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&status.stderr)
        );
    }

    /// A repository with one commit and a spare `feature` branch.
    fn scratch_repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("gitty-wt-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temp dir");
        run_git(&root, &["init", "-q", "-b", "main", "."]);
        run_git(&root, &["config", "user.email", "test@example.com"]);
        run_git(&root, &["config", "user.name", "Test"]);
        fs::write(root.join("a.txt"), "one").expect("write");
        run_git(&root, &["add", "-A"]);
        run_git(&root, &["commit", "-qm", "first"]);
        run_git(&root, &["branch", "feature"]);
        root
    }

    fn paths_of(repo: &Path) -> Vec<String> {
        list_worktrees(repo.to_string_lossy().to_string())
            .expect("list")
            .into_iter()
            .map(|entry| entry.path)
            .collect()
    }

    #[test]
    fn adds_a_worktree_for_an_existing_branch() {
        let repo = scratch_repo("add");
        let target = repo.parent().unwrap().join(format!(
            "gitty-wt-added-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&target);

        let created = add_worktree(
            repo.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
            "feature".to_string(),
            Some(false),
        )
        .expect("add_worktree should succeed");

        assert!(Path::new(&created).exists(), "folder should be on disk");
        let entries = list_worktrees(repo.to_string_lossy().to_string()).expect("list");
        assert_eq!(entries.len(), 2);
        let added = entries
            .iter()
            .find(|entry| !entry.is_main)
            .expect("linked worktree present");
        assert_eq!(added.branch.as_deref(), Some("feature"));

        let _ = fs::remove_dir_all(&target);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn refuses_a_folder_that_already_exists() {
        let repo = scratch_repo("exists");
        // The repository's own folder is the simplest thing that already exists.
        let err = add_worktree(
            repo.to_string_lossy().to_string(),
            repo.to_string_lossy().to_string(),
            "feature".to_string(),
            Some(false),
        )
        .expect_err("should refuse an existing folder");
        assert!(err.contains("already exists"), "got: {err}");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn removing_the_main_checkout_is_refused() {
        let repo = scratch_repo("main-guard");
        let err = remove_worktree(
            repo.to_string_lossy().to_string(),
            repo.to_string_lossy().to_string(),
            Some(false),
        )
        .expect_err("the main checkout must not be removable here");
        assert!(err.contains("main folder"), "got: {err}");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn removes_a_linked_worktree() {
        let repo = scratch_repo("remove");
        let target = repo
            .parent()
            .unwrap()
            .join(format!("gitty-wt-remove-{}", std::process::id()));
        let _ = fs::remove_dir_all(&target);

        add_worktree(
            repo.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
            "feature".to_string(),
            Some(false),
        )
        .expect("add");
        assert_eq!(paths_of(&repo).len(), 2);

        remove_worktree(
            repo.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
            Some(false),
        )
        .expect("remove_worktree should succeed");

        assert!(!target.exists(), "folder should be gone from disk");
        assert_eq!(paths_of(&repo).len(), 1, "registration should be gone too");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn prune_forgets_a_folder_deleted_behind_gits_back() {
        let repo = scratch_repo("prune");
        let target = repo
            .parent()
            .unwrap()
            .join(format!("gitty-wt-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&target);

        add_worktree(
            repo.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
            "feature".to_string(),
            Some(false),
        )
        .expect("add");

        // Delete the folder the way a user would, leaving git's registration behind.
        fs::remove_dir_all(&target).expect("remove folder");
        let before = list_worktrees(repo.to_string_lossy().to_string()).expect("list");
        assert_eq!(before.len(), 2, "git still remembers it");
        assert!(
            before.iter().any(|entry| entry.prunable),
            "the stale entry should be flagged prunable"
        );

        prune_worktrees(repo.to_string_lossy().to_string()).expect("prune");
        assert_eq!(paths_of(&repo).len(), 1, "stale registration dropped");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn creates_a_new_branch_when_asked() {
        let repo = scratch_repo("newbranch");
        let target = repo
            .parent()
            .unwrap()
            .join(format!("gitty-wt-new-{}", std::process::id()));
        let _ = fs::remove_dir_all(&target);

        add_worktree(
            repo.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
            "brand-new".to_string(),
            Some(true),
        )
        .expect("add with create_branch");

        let entries = list_worktrees(repo.to_string_lossy().to_string()).expect("list");
        assert!(
            entries
                .iter()
                .any(|entry| entry.branch.as_deref() == Some("brand-new")),
            "the new branch should be checked out in the new folder"
        );

        let _ = fs::remove_dir_all(&target);
        let _ = fs::remove_dir_all(&repo);
    }

    /// The writability probe creates a directory to prove it can. Named on the
    /// process id alone, two probes of the same parent at once collided: the
    /// loser's create failed with "already exists" and was reported to the user
    /// as "you cannot write here". It showed up as add_worktree failing about
    /// one suite run in three, since tests share a process, and would have done
    /// the same to two adds running together in the app.
    #[test]
    fn concurrent_writability_probes_do_not_collide() {
        let dir = std::env::temp_dir().join(format!("gitty-probe-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");

        let target = dir.join("not-created-yet");
        let failures: Vec<String> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..8)
                .map(|_| scope.spawn(|| writable_ancestor(&target)))
                .collect();
            handles
                .into_iter()
                .filter_map(|h| h.join().expect("probe thread").err())
                .collect()
        });

        assert!(
            failures.is_empty(),
            "probing one directory from several threads reported it unwritable: {failures:?}"
        );
        // And nothing is left behind afterwards.
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .expect("read temp dir")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(leftovers.is_empty(), "probe files left behind: {leftovers:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    /// An annotated tag's own object hash is not the commit it points at, and
    /// the remote side reports the peeled commit. Comparing the two marked every
    /// annotated tag as unpushed for ever -- 72 of 244 in one real repository,
    /// every one of them already on the remote.
    /// The push button's headline behaviour, which had no test at all: a
    /// commits-only push must not carry tags, to the primary *or* to a backup.
    ///
    /// A fork carries the upstream's whole release history -- tags arrive with
    /// a fetch and `git push` never mirrors them -- so "unpushed tags" on a
    /// fork are usually someone else's releases. Pushing them republishes them
    /// under the fork's name. The backup path got this wrong while the primary
    /// path got it right, and nothing failed.
    #[test]
    fn a_commits_only_push_carries_no_tags_to_any_remote() {
        let repo = scratch_repo("tags-optin");
        let make_remote = |suffix: &str| {
            let path = repo
                .parent()
                .unwrap()
                .join(format!("gitty-optin-{}-{}.git", suffix, std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("remote dir");
            run_git(&path, &["init", "-q", "--bare", "."]);
            path
        };
        let origin = make_remote("origin");
        let backup = make_remote("backup");
        run_git(&repo, &["remote", "add", "origin", &origin.to_string_lossy()]);
        run_git(&repo, &["remote", "add", "backup", &backup.to_string_lossy()]);
        run_git(&repo, &["push", "-q", "origin", "main"]);
        run_git(&repo, &["tag", "-a", "v9.9.9", "-m", "someone else's release"]);

        assert!(
            tags_for_push(&repo, false).is_empty(),
            "a commits-only push must not select any tag for the primary remote"
        );
        assert!(
            backup_tags_for_push(&repo, "backup", false).is_empty(),
            "a commits-only push must not select any tag for a backup remote either -- \
             this is the case that shipped broken"
        );

        // And the opt-in still works, or the flag would be a way to never push
        // a tag at all.
        assert!(
            tags_for_push(&repo, true).contains(&"v9.9.9".to_string()),
            "opting in must still select the unpushed tag"
        );
        assert!(
            backup_tags_for_push(&repo, "backup", true).contains(&"v9.9.9".to_string()),
            "opting in must still select the tag for the backup remote"
        );

        let _ = fs::remove_dir_all(&origin);
        let _ = fs::remove_dir_all(&backup);
    }

    #[test]
    fn a_pushed_annotated_tag_is_not_reported_as_unpushed() {
        let repo = scratch_repo("tags");
        let remote = repo
            .parent()
            .unwrap()
            .join(format!("gitty-tag-remote-{}.git", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).expect("remote dir");
        run_git(&remote, &["init", "-q", "--bare", "."]);
        run_git(&repo, &["remote", "add", "origin", &remote.to_string_lossy()]);

        // One of each kind: the lightweight tag always compared equal, so the
        // bug was invisible in a repository that only used those.
        run_git(&repo, &["tag", "light-1"]);
        run_git(&repo, &["tag", "-a", "annotated-1", "-m", "a release"]);
        run_git(&repo, &["push", "-q", "origin", "main", "--tags"]);

        let unpushed = unpushed_tags(&repo);
        assert!(
            unpushed.is_empty(),
            "both tags are on the remote, but these were reported unpushed: {unpushed:?}"
        );

        // And a tag that genuinely has not been pushed is still caught.
        run_git(&repo, &["tag", "-a", "annotated-2", "-m", "not pushed"]);
        assert_eq!(unpushed_tags(&repo), vec!["annotated-2".to_string()]);

        let _ = fs::remove_dir_all(&remote);
        let _ = fs::remove_dir_all(&repo);
    }

    /// A fetch that could not reach the remote still rewrites FETCH_HEAD, so
    /// its mtime moves forward on failure just as it does on success. Only the
    /// file's contents tell the two apart, and reporting a failed fetch as
    /// fresh is the "in sync with a remote we never reached" claim the unknown
    /// state was added to prevent.
    #[test]
    fn a_failed_fetch_does_not_count_as_reaching_the_remote() {
        let repo = scratch_repo("fetchfail");
        let remote = repo
            .parent()
            .unwrap()
            .join(format!("gitty-wt-remote-{}.git", std::process::id()));
        let _ = fs::remove_dir_all(&remote);
        fs::create_dir_all(&remote).expect("remote dir");
        run_git(&remote, &["init", "-q", "--bare", "."]);

        // Never fetched: no FETCH_HEAD at all.
        assert_eq!(last_fetched_at(&repo), None, "never fetched is unknown");

        run_git(&repo, &["remote", "add", "origin", &remote.to_string_lossy()]);
        run_git(&repo, &["push", "-q", "origin", "main"]);
        run_git(&repo, &["fetch", "-q", "origin"]);
        assert!(
            last_fetched_at(&repo).is_some(),
            "a fetch that reached the remote is a real timestamp"
        );

        // Point the remote somewhere that cannot answer. Git empties
        // FETCH_HEAD but still updates its mtime.
        run_git(
            &repo,
            &["remote", "set-url", "origin", "/nonexistent/nope.git"],
        );
        let _ = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["fetch", "origin"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .output();

        assert_eq!(
            last_fetched_at(&repo),
            None,
            "a failed fetch must read as unknown, not fresh"
        );

        let _ = fs::remove_dir_all(&remote);
        let _ = fs::remove_dir_all(&repo);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_urls_equal() {
        assert!(git_urls_equal(
            "https://gitto.c0di.com/git/codi/Gitty.git",
            "https://gitto.c0di.com/git/codi/gitty.git"
        ));
        assert!(git_urls_equal(
            "https://gitto.c0di.com/git/codi/gitty",
            "https://gitto.c0di.com/git/codi/gitty.git"
        ));
        assert!(git_urls_equal(
            "https://gitto.c0di.com/git/codi/gitty/",
            "https://gitto.c0di.com/git/codi/gitty.git"
        ));
        assert!(!git_urls_equal(
            "https://gitto.c0di.com/git/codi/other.git",
            "https://gitto.c0di.com/git/codi/gitty.git"
        ));
    }

    #[test]
    fn network_idle_timeout_allows_ongoing_progress() {
        assert!(!network_operation_is_idle(
            Duration::from_secs(90),
            Duration::from_secs(89).as_millis() as u64,
        ));
        assert!(network_operation_is_idle(Duration::from_secs(120), 0));
    }

    #[test]
    fn diff_preview_cap_respects_utf8_boundaries() {
        let input = "🦊".repeat(MAX_DISPLAY_DIFF_BYTES);
        let (preview, truncated) = truncate_diff_for_display(input);
        assert!(truncated);
        assert!(preview.len() <= MAX_DISPLAY_DIFF_BYTES);
        assert!(std::str::from_utf8(preview.as_bytes()).is_ok());
    }
}
