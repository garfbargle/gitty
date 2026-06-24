use crate::settings;
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::Path,
};
use tauri::AppHandle;

const MAX_FILE_DIFF: usize = 8_192;
const MAX_TOTAL_CONTEXT: usize = 96_000;
const MAX_FILES: usize = 40;
const NVIDIA_API_URL: &str = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL: &str = "meta/llama-3.1-8b-instruct";
const COMMIT_MESSAGE_SYSTEM_PROMPT: &str =
    "Write git commit messages. Reply with only the message text—no labels, quotes, or preamble.";

const FEW_SHOT_DIFF: &str = r#"--- config.ts ---
-export const TIMEOUT = 30
+export const TIMEOUT = 60"#;

const FEW_SHOT_MESSAGE: &str = "Increase request timeout to 60 seconds";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    pub summary: String,
    pub fingerprint: String,
    pub scope: String,
    pub files_included: usize,
    pub files_skipped: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SummarizeScope {
    All,
    Staged,
}

impl SummarizeScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Staged => "staged",
        }
    }

    fn parse(value: Option<&str>) -> Self {
        match value {
            Some("staged") => Self::Staged,
            _ => Self::All,
        }
    }
}

pub fn parse_summarize_scope(value: Option<&str>) -> SummarizeScope {
    SummarizeScope::parse(value)
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    max_tokens: u32,
    temperature: f32,
    top_p: f32,
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: String,
}

#[derive(serde::Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(serde::Deserialize)]
struct ChatChoice {
    message: ChatMessageContent,
}

#[derive(serde::Deserialize)]
struct ChatMessageContent {
    content: String,
}

pub fn summarize_changes(
    app: &AppHandle,
    repo_path: &Path,
    scope: SummarizeScope,
) -> Result<ChangeSummary, String> {
    let api_key = settings::nvidia_api_key(app)?;

    let paths = collect_change_paths(repo_path, scope)?;
    if paths.is_empty() {
        return Err(if scope == SummarizeScope::Staged {
            "No staged changes to summarize.".to_string()
        } else {
            "No changes to summarize.".to_string()
        });
    }

    let fingerprint = fingerprint_paths(&paths, scope);
    let (context, files_included, files_skipped) = build_diff_context(repo_path, &paths, scope)?;
    if context.trim().is_empty() {
        return Err("All changed files were skipped (binaries, lockfiles, or large data).".to_string());
    }

    let summary = call_nvidia_api(&api_key, &context, files_skipped)?;
    Ok(ChangeSummary {
        summary,
        fingerprint,
        scope: scope.as_str().to_string(),
        files_included,
        files_skipped,
    })
}

fn collect_change_paths(repo_path: &Path, scope: SummarizeScope) -> Result<Vec<String>, String> {
    let output = git(repo_path, &["status", "--porcelain=v1", "-uall"])?;
    let mut paths = Vec::new();

    for line in output.lines() {
        if line.len() < 4 {
            continue;
        }
        let index = line.as_bytes().first().copied().unwrap_or(b' ');
        let worktree = line.as_bytes().get(1).copied().unwrap_or(b' ');
        let raw_path = line.get(3..).unwrap_or("").trim().to_string();
        let path = raw_path
            .split_once(" -> ")
            .map(|(_, path)| path.to_string())
            .unwrap_or(raw_path);

        let include = match scope {
            SummarizeScope::All => {
                (index != b' ' && index != b'?') || worktree != b' ' || (index == b'?' && worktree == b'?')
            }
            SummarizeScope::Staged => index != b' ' && index != b'?',
        };

        if include {
            paths.push(path);
        }
    }

    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn fingerprint_paths(paths: &[String], scope: SummarizeScope) -> String {
    let mut hasher = DefaultHasher::new();
    scope.as_str().hash(&mut hasher);
    for path in paths {
        path.hash(&mut hasher);
    }
    format!("{:x}", hasher.finish())
}

fn build_diff_context(
    repo_path: &Path,
    paths: &[String],
    scope: SummarizeScope,
) -> Result<(String, usize, usize), String> {
    let mut context = String::new();
    let mut files_included = 0;
    let mut files_skipped = 0;

    for path in paths.iter().take(MAX_FILES) {
        if context.len() >= MAX_TOTAL_CONTEXT {
            files_skipped += 1;
            continue;
        }

        if let Some(reason) = skip_reason(path) {
            context.push_str(&format!("--- {path} ---\n(skipped: {reason})\n\n"));
            files_skipped += 1;
            continue;
        }

        let diff = fetch_file_diff(repo_path, path, scope)?;
        if diff.contains("Binary files") {
            context.push_str(&format!("--- {path} ---\n(skipped: binary file)\n\n"));
            files_skipped += 1;
            continue;
        }

        if looks_like_tabular_data(&diff) {
            context.push_str(&format!(
                "--- {path} ---\n(skipped: tabular or CSV-like data)\n\n"
            ));
            files_skipped += 1;
            continue;
        }

        let truncated = truncate_diff(&diff, MAX_FILE_DIFF);
        context.push_str(&format!("--- {path} ---\n{truncated}\n\n"));
        files_included += 1;

        if context.len() > MAX_TOTAL_CONTEXT {
            context.truncate(MAX_TOTAL_CONTEXT);
            context.push_str("\n...(context truncated)\n");
            break;
        }
    }

    if paths.len() > MAX_FILES {
        files_skipped += paths.len() - MAX_FILES;
        context.push_str(&format!(
            "\n({} additional files omitted from context)\n",
            paths.len() - MAX_FILES
        ));
    }

    Ok((context, files_included, files_skipped))
}

fn skip_reason(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);

    if lower.contains("/node_modules/")
        || lower.contains("/dist/")
        || lower.contains("/build/")
        || lower.contains("/target/")
        || lower.contains("/.git/")
        || lower.contains("/__pycache__/")
        || lower.contains("/coverage/")
    {
        return Some("generated or vendor path");
    }

    let lockfiles = [
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "cargo.lock",
        "gemfile.lock",
        "poetry.lock",
        "composer.lock",
        "mix.lock",
        "go.sum",
        "pipfile.lock",
    ];
    if lockfiles
        .iter()
        .any(|name| file_name.eq_ignore_ascii_case(name))
    {
        return Some("lockfile");
    }

    if lower.ends_with(".map")
        || lower.ends_with(".min.js")
        || lower.ends_with(".min.css")
        || lower.ends_with(".lock")
    {
        return Some("generated or minified file");
    }

    const BINARY_EXTENSIONS: &[&str] = &[
        "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff", "psd", "pdf", "zip",
        "tar", "gz", "bz2", "xz", "7z", "rar", "exe", "dll", "so", "dylib", "bin", "o", "a",
        "wasm", "mp3", "mp4", "mov", "avi", "mkv", "woff", "woff2", "ttf", "otf", "eot", "db",
        "sqlite", "sqlite3", "pyc", "class", "jar", "keystore", "pem", "p12", "dmg", "pkg",
    ];

    if let Some(ext) = Path::new(path).extension().and_then(|ext| ext.to_str()) {
        let ext = ext.to_ascii_lowercase();
        if BINARY_EXTENSIONS.contains(&ext.as_str()) {
            return Some("binary extension");
        }
    }

    None
}

fn fetch_file_diff(
    repo_path: &Path,
    file_path: &str,
    scope: SummarizeScope,
) -> Result<String, String> {
    let args = match scope {
        SummarizeScope::Staged => vec![
            "--no-pager".to_string(),
            "diff".to_string(),
            "--cached".to_string(),
            "--color=never".to_string(),
            "--".to_string(),
            file_path.to_string(),
        ],
        SummarizeScope::All => vec![
            "--no-pager".to_string(),
            "diff".to_string(),
            "HEAD".to_string(),
            "--color=never".to_string(),
            "--".to_string(),
            file_path.to_string(),
        ],
    };
    git_owned(repo_path, args)
}

fn truncate_diff(diff: &str, max_bytes: usize) -> String {
    if diff.len() <= max_bytes {
        return diff.to_string();
    }

    let mut end = max_bytes;
    while end > 0 && !diff.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n...(diff truncated)", &diff[..end])
}

fn looks_like_tabular_data(diff: &str) -> bool {
    let changed_lines: Vec<_> = diff
        .lines()
        .filter(|line| line.starts_with('+') || line.starts_with('-'))
        .filter(|line| !line.starts_with("+++") && !line.starts_with("---"))
        .collect();

    if changed_lines.len() < 12 {
        return false;
    }

    let delimiter_heavy = changed_lines
        .iter()
        .filter(|line| {
            let body = line.trim_start_matches(['+', '-']);
            line.matches(',').count() >= 3
                || line.matches('\t').count() >= 3
                || body.split('|').count() >= 4
        })
        .count();

    delimiter_heavy * 2 > changed_lines.len()
}

fn call_nvidia_api(api_key: &str, context: &str, files_skipped: usize) -> Result<String, String> {
    let skipped_note = if files_skipped > 0 {
        format!("\n\n({files_skipped} file(s) omitted: binaries, lockfiles, or large data.)")
    } else {
        String::new()
    };

    let diff_context = format!("{context}{skipped_note}");

    let raw = chat_completion(
        api_key,
        commit_message_prompt(&diff_context, false),
        96,
        0.15,
    )?;

    if let Some(summary) = extract_commit_message(&raw) {
        return Ok(summary);
    }

    let raw = chat_completion(
        api_key,
        commit_message_prompt(&diff_context, true),
        96,
        0.1,
    )?;

    extract_commit_message(&raw)
        .ok_or_else(|| "Could not produce a valid commit message. Try again.".to_string())
}

fn commit_message_prompt(context: &str, minimal: bool) -> Vec<ChatMessage<'static>> {
    if minimal {
        return vec![
            ChatMessage {
                role: "system",
                content: "Write one git commit message from the diff. Output only the message."
                    .to_string(),
            },
            ChatMessage {
                role: "user",
                content: format!("Diff:\n\n{context}"),
            },
        ];
    }

    vec![
        ChatMessage {
            role: "system",
            content: COMMIT_MESSAGE_SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user",
            content: format!("Diff:\n\n{FEW_SHOT_DIFF}"),
        },
        ChatMessage {
            role: "assistant",
            content: FEW_SHOT_MESSAGE.to_string(),
        },
        ChatMessage {
            role: "user",
            content: format!("Diff:\n\n{context}"),
        },
    ]
}

pub fn verify_nvidia_api_key(api_key: &str) -> Result<(), String> {
    chat_completion(
        api_key,
        vec![ChatMessage {
            role: "user",
            content: "Reply with OK.".to_string(),
        }],
        8,
        0.2,
    )
    .map(|_| ())
}

fn chat_completion(
    api_key: &str,
    messages: Vec<ChatMessage<'_>>,
    max_tokens: u32,
    temperature: f32,
) -> Result<String, String> {
    let request = ChatRequest {
        model: NVIDIA_MODEL,
        messages,
        max_tokens,
        temperature,
        top_p: 0.95,
        stream: false,
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|err| format!("Could not create HTTP client: {err}"))?;

    let response = client
        .post(NVIDIA_API_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .map_err(|err| format!("NVIDIA API request failed: {err}"))?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|err| format!("Could not read NVIDIA API response: {err}"))?;

    if !status.is_success() {
        return Err(format_nvidia_error(status.as_u16(), &body));
    }

    let parsed: ChatResponse = serde_json::from_str(&body)
        .map_err(|err| format!("Could not parse NVIDIA API response: {err}\n{body}"))?;

    parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| normalize_summary(&choice.message.content))
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "NVIDIA API returned an empty summary.".to_string())
}

fn normalize_summary(raw: &str) -> String {
    let mut summary = raw.trim().trim_matches('"').to_string();

    for prefix in [
        "Commit message:",
        "Suggested commit message:",
        "Here's a summary:",
        "Here's the commit message:",
        "Draft commit message:",
    ] {
        if let Some(rest) = summary.strip_prefix(prefix) {
            summary = rest.trim().to_string();
        }
    }

    summary
}

fn extract_commit_message(raw: &str) -> Option<String> {
    let normalized = normalize_summary(raw);

    if is_plausible_commit_message(&normalized) {
        return Some(normalized);
    }

    for block in normalized.split("\n\n") {
        let block = block.trim();
        if is_plausible_commit_message(block) {
            return Some(block.to_string());
        }
    }

    for line in normalized.lines() {
        let line = line.trim();
        if is_plausible_commit_message(line) {
            return Some(line.to_string());
        }
    }

    None
}

fn is_plausible_commit_message(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() || text.len() > 300 {
        return false;
    }
    if looks_like_prompt_leakage(text) {
        return false;
    }
    if text.contains("\n- ") || text.starts_with("- ") {
        return false;
    }
    if text.lines().count() > 4 {
        return false;
    }
    true
}

fn looks_like_prompt_leakage(text: &str) -> bool {
    let lower = text.to_lowercase();
    const MARKERS: &[&str] = &[
        "never copy",
        "never adapt",
        "base the message",
        "code diffs",
        "output format",
        "illustrative only",
        "do not mention",
        "you write",
        "suggest commit",
        "imperative title",
        "additive body",
        "rules:",
        "examples below",
        "reply with only",
        "write git commit",
        "from the diffs",
        "from the user message",
        "marketing language",
        "implementation trivia",
        "no labels, quotes",
    ];
    MARKERS.iter().any(|marker| lower.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_prompt_leakage() {
        let leaked = "Suggest commit messages from code diffs.\n\nBase the message only on the diffs.";
        assert!(looks_like_prompt_leakage(leaked));
        assert!(extract_commit_message(leaked).is_none());
    }

    #[test]
    fn accepts_plain_commit_message() {
        let message = "Fix combat damage calculation in CombatService";
        assert!(extract_commit_message(message).is_some());
    }

    #[test]
    fn extracts_message_from_preamble() {
        let raw = "Here's the commit message:\n\nFix null pointer in parser";
        let extracted = extract_commit_message(raw).unwrap();
        assert_eq!(extracted, "Fix null pointer in parser");
    }
}

fn format_nvidia_error(status: u16, body: &str) -> String {
    if status == 401 {
        return "NVIDIA authentication failed. Paste the full nvapi- key from \
                build.nvidia.com/models (generate it from a model page after accepting terms)."
            .to_string();
    }
    if status == 403 {
        return "NVIDIA access denied. Your key may be missing Public API Endpoints permission — \
                generate a new key from build.nvidia.com/models."
            .to_string();
    }
    format!("NVIDIA API error ({status}): {body}")
}

fn git(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    git_owned(
        repo_path,
        args.iter().map(|arg| (*arg).to_string()).collect(),
    )
}

fn git_owned(repo_path: &Path, args: Vec<String>) -> Result<String, String> {
    use std::process::Command;

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
