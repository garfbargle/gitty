use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const ICON_CACHE_FILE: &str = "repo-icon-cache.json";
const ICON_OVERRIDE_FILE: &str = "repo-icon-overrides.json";
const MAX_ICON_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SEARCH_DEPTH: usize = 6;
const MAX_FILES_SCANNED: usize = 2500;
const MAX_PICKER_IMAGES: usize = 60;
// Minimum score for the shallow top-level scan to preempt the full tree walk —
// clears favicon/app-icon/apple-touch names, but not bare "logo"/"icon".
const TOP_LEVEL_CONFIDENT_SCORE: i32 = 80;

const HTML_ENTRYPOINTS: &[&str] = &["index.html", "public/index.html", "src/index.html"];

const GITTY_ICON_CANDIDATES: &[&str] = &[
    ".gitty/icon.png",
    ".gitty/icon.svg",
    ".gitty/icon.ico",
    ".gitty/icon.webp",
    ".gitty/logo.png",
    ".gitty/logo.svg",
];

const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    ".cursor",
    ".turbo",
    ".cache",
    ".next",
    ".nuxt",
    ".output",
    ".svelte-kit",
    "__pycache__",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
    "vendor",
    "Pods",
    "DerivedData",
    "output",
    "tmp",
    "temp",
];

const EXCLUDED_NAME_PARTS: &[&str] = &[
    "screenshot",
    "launch-og",
    "launch_og",
    "hero",
    "avatar",
    "badge",
    "placeholder",
    "mock",
    "sample",
    "proof",
    "store_",
    "banner",
    "og-image",
    "og_image",
    "social",
    "preview",
    "thumb",
    "thumbnail",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct IconCacheStore {
    entries: HashMap<String, String>,
}

fn config_file(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not locate app config directory: {err}"))?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Could not create config directory {}: {err}", dir.display()))?;
    Ok(dir.join(file))
}

fn load_store(app: &AppHandle, file: &str) -> Result<IconCacheStore, String> {
    let path = config_file(app, file)?;
    if !path.exists() {
        return Ok(IconCacheStore::default());
    }

    let data = fs::read_to_string(&path)
        .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
    serde_json::from_str(&data).map_err(|err| format!("Could not parse {}: {err}", path.display()))
}

fn save_store(app: &AppHandle, file: &str, store: &IconCacheStore) -> Result<(), String> {
    let path = config_file(app, file)?;
    let data = serde_json::to_string_pretty(store)
        .map_err(|err| format!("Could not serialize {file}: {err}"))?;
    fs::write(&path, data).map_err(|err| format!("Could not write {}: {err}", path.display()))
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("svg") => Some("image/svg+xml"),
        Some("ico") => Some("image/x-icon"),
        Some("bmp") => Some("image/bmp"),
        Some("avif") => Some("image/avif"),
        _ => None,
    }
}

fn is_supported_icon_extension(path: &Path) -> bool {
    image_mime_type(path).is_some()
}

fn normalize_icon_href(href: &str) -> String {
    let trimmed = href.trim();
    let without_query = trimmed.split(['?', '#']).next().unwrap_or(trimmed);
    without_query
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

fn normalize_name(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace('-', "_")
        .replace('.', "_")
}

fn should_skip_dir(name: &str) -> bool {
    if name == ".gitty" {
        return false;
    }

    let lower = name.to_ascii_lowercase();
    if lower.starts_with('.') {
        return true;
    }

    SKIP_DIR_NAMES.iter().any(|skip| lower == *skip)
}

fn score_icon_filename(file_name: &str) -> Option<i32> {
    let path = Path::new(file_name);
    if !is_supported_icon_extension(path) {
        return None;
    }

    let stem = normalize_name(path.file_stem()?.to_str()?);
    if stem.is_empty() {
        return None;
    }

    if EXCLUDED_NAME_PARTS.iter().any(|part| stem.contains(part)) {
        return None;
    }

    let score = if stem == "favicon" {
        100
    } else if stem.starts_with("favicon_") || stem.ends_with("_favicon") {
        95
    } else if stem == "appicon" || stem == "app_icon" {
        88
    } else if stem.starts_with("appicon_") || stem.starts_with("app_icon_") {
        84
    } else if stem.contains("appicon") || stem.contains("app_icon") {
        80
    } else if stem.contains("apple_touch_icon") {
        76
    } else if stem == "icon" {
        62
    } else if stem.starts_with("icon_") || stem.ends_with("_icon") {
        58
    } else if stem == "logo" {
        52
    } else if stem.starts_with("logo_") || stem.ends_with("_logo") {
        48
    } else if stem.contains("favicon") {
        92
    } else if stem.contains("icon") {
        56
    } else if stem.contains("logo") {
        46
    } else {
        return None;
    };

    Some(score)
}

#[derive(Debug, Clone)]
struct IconCandidate {
    relative_path: String,
    score: i32,
    depth: usize,
    size: u64,
}

fn read_icon_bytes(repo_root: &Path, relative: &str) -> Option<Vec<u8>> {
    let relative = normalize_icon_href(relative);
    let file_path = repo_root.join(&relative);
    if !file_path.is_file() {
        return None;
    }

    let metadata = fs::metadata(&file_path).ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_ICON_BYTES {
        return None;
    }

    if !is_supported_icon_extension(&file_path) {
        return None;
    }

    let bytes = fs::read(&file_path).ok()?;
    if bytes.is_empty() {
        return None;
    }

    Some(bytes)
}

fn icon_bytes_to_data_url(bytes: &[u8], path: &Path) -> Option<String> {
    let mime = image_mime_type(path)?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn read_icon_data_url(repo_root: &Path, relative: &str) -> Option<String> {
    let relative = normalize_icon_href(relative);
    let file_path = repo_root.join(&relative);
    let bytes = read_icon_bytes(repo_root, &relative)?;
    icon_bytes_to_data_url(&bytes, &file_path)
}

fn extract_attr_value(tag: &str, attr: &str) -> Option<String> {
    let tag_lower = tag.to_ascii_lowercase();
    let attr_lower = attr.to_ascii_lowercase();

    for quote in ['"', '\''] {
        let needle = format!("{attr_lower}={quote}");
        let start = tag_lower.find(&needle)? + needle.len();
        let rest = &tag[start..];
        let end = rest.find(quote)?;
        return Some(rest[..end].to_string());
    }

    None
}

fn link_tag_is_icon(tag_lower: &str) -> bool {
    let rel = extract_attr_value(tag_lower, "rel").unwrap_or_default();
    let rel = rel.to_ascii_lowercase();
    rel.contains("icon") || rel.contains("apple-touch-icon") || rel.contains("shortcut icon")
}

fn favicon_hrefs_from_html(html_path: &Path) -> Vec<String> {
    let content = match fs::read_to_string(html_path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };

    let content_lower = content.to_ascii_lowercase();
    let mut hrefs = Vec::new();
    let mut search_from = 0;

    while let Some(link_start) = content_lower[search_from..].find("<link") {
        let abs_start = search_from + link_start;
        let Some(tag_end_offset) = content_lower[abs_start..].find('>') else {
            break;
        };
        let tag_end = abs_start + tag_end_offset;
        let tag = &content[abs_start..=tag_end];
        let tag_lower = &content_lower[abs_start..=tag_end];

        if link_tag_is_icon(tag_lower) {
            if let Some(href) = extract_attr_value(tag, "href") {
                let href = normalize_icon_href(&href);
                if !href.is_empty()
                    && !href.starts_with("http://")
                    && !href.starts_with("https://")
                    && !href.starts_with("//")
                    && !hrefs.contains(&href)
                {
                    hrefs.push(href);
                }
            }
        }

        search_from = tag_end + 1;
    }

    hrefs
}

fn search_icons_from_html(repo_root: &Path) -> Option<String> {
    for html_entry in HTML_ENTRYPOINTS {
        let html_path = repo_root.join(html_entry);
        if !html_path.is_file() {
            continue;
        }

        for href in favicon_hrefs_from_html(&html_path) {
            if read_icon_bytes(repo_root, &href).is_some() {
                return Some(href);
            }
        }
    }
    None
}

fn search_gitty_override(repo_root: &Path) -> Option<String> {
    for candidate in GITTY_ICON_CANDIDATES {
        if read_icon_bytes(repo_root, candidate).is_some() {
            return Some(normalize_icon_href(candidate));
        }
    }
    None
}

fn walk_for_icon_candidates(
    repo_root: &Path,
    dir: &Path,
    relative: &Path,
    depth: usize,
    scanned: &mut usize,
    candidates: &mut Vec<IconCandidate>,
) {
    if depth > MAX_SEARCH_DEPTH || *scanned >= MAX_FILES_SCANNED {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if *scanned >= MAX_FILES_SCANNED {
            return;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if file_type.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            let next_relative = if relative.as_os_str().is_empty() {
                PathBuf::from(name.as_ref())
            } else {
                relative.join(name.as_ref())
            };
            walk_for_icon_candidates(
                repo_root,
                &entry.path(),
                &next_relative,
                depth + 1,
                scanned,
                candidates,
            );
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        *scanned += 1;

        let Some(base_score) = score_icon_filename(&name) else {
            continue;
        };

        let relative_path = if relative.as_os_str().is_empty() {
            name.to_string()
        } else {
            relative.join(name.as_ref()).to_string_lossy().to_string()
        };

        let size = fs::metadata(entry.path()).ok().map(|meta| meta.len()).unwrap_or(0);
        if size == 0 || size > MAX_ICON_BYTES {
            continue;
        }

        let depth_penalty = (depth as i32) * 3;
        let size_penalty = if size > 256 * 1024 { 4 } else { 0 };
        let score = base_score - depth_penalty - size_penalty;

        candidates.push(IconCandidate {
            relative_path,
            score,
            depth,
            size,
        });
    }
}

fn best_candidate_entry(mut candidates: Vec<IconCandidate>) -> Option<IconCandidate> {
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.depth.cmp(&right.depth))
            .then_with(|| left.size.cmp(&right.size))
    });

    candidates.into_iter().next()
}

fn best_candidate(candidates: Vec<IconCandidate>) -> Option<String> {
    best_candidate_entry(candidates).map(|candidate| candidate.relative_path)
}

/// Score the icon-named files directly inside a single directory (no recursion).
fn score_dir_icon_files(dir: &Path, relative: &Path, depth: usize) -> Vec<IconCandidate> {
    let mut candidates = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return candidates,
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        let Some(base_score) = score_icon_filename(&name) else {
            continue;
        };

        let size = fs::metadata(entry.path()).ok().map(|meta| meta.len()).unwrap_or(0);
        if size == 0 || size > MAX_ICON_BYTES {
            continue;
        }

        let relative_path = if relative.as_os_str().is_empty() {
            name.to_string()
        } else {
            relative.join(name.as_ref()).to_string_lossy().to_string()
        };

        let depth_penalty = (depth as i32) * 3;
        let size_penalty = if size > 256 * 1024 { 4 } else { 0 };

        candidates.push(IconCandidate {
            relative_path,
            score: base_score - depth_penalty - size_penalty,
            depth,
            size,
        });
    }

    candidates
}

/// Fast, shallow scan: the repo root plus each immediate top-level subdirectory
/// (e.g. `marketing/app-icon.png`). Bounded to two levels so it stays cheap even
/// on large repos, and runs before the exhaustive tree walk.
fn search_icons_top_level(repo_root: &Path) -> Option<String> {
    let mut candidates = score_dir_icon_files(repo_root, Path::new(""), 0);

    if let Ok(entries) = fs::read_dir(repo_root) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            if should_skip_dir(&name) {
                continue;
            }
            candidates.append(&mut score_dir_icon_files(
                &entry.path(),
                Path::new(name.as_ref()),
                1,
            ));
        }
    }

    // Only short-circuit the exhaustive walk when the shallow winner is a
    // high-confidence name (favicon / app-icon / apple-touch-icon). Generic
    // "logo"/"icon" names could still be beaten by a stronger match deeper in
    // the tree, so those fall through to the full walk.
    best_candidate_entry(candidates)
        .filter(|candidate| candidate.score >= TOP_LEVEL_CONFIDENT_SCORE)
        .map(|candidate| candidate.relative_path)
}

fn search_icons_in_tree(repo_root: &Path) -> Option<String> {
    let mut candidates = Vec::new();
    let mut scanned = 0;
    walk_for_icon_candidates(repo_root, repo_root, Path::new(""), 0, &mut scanned, &mut candidates);

    best_candidate(candidates)
}

pub fn search_repo_icon(repo_root: &Path) -> Option<String> {
    search_gitty_override(repo_root)
        .or_else(|| search_icons_from_html(repo_root))
        .or_else(|| search_icons_top_level(repo_root))
        .or_else(|| search_icons_in_tree(repo_root))
}

fn set_cached_icon(app: &AppHandle, repo_path: &str, relative: Option<&str>) -> Result<(), String> {
    let mut cache = load_store(app, ICON_CACHE_FILE)?;
    match relative {
        Some(path) => {
            cache.entries.insert(repo_path.to_string(), path.to_string());
        }
        None => {
            cache.entries.remove(repo_path);
        }
    }
    save_store(app, ICON_CACHE_FILE, &cache)
}

fn icon_override(app: &AppHandle, repo_path: &str) -> Result<Option<String>, String> {
    Ok(load_store(app, ICON_OVERRIDE_FILE)?
        .entries
        .get(repo_path)
        .cloned())
}

/// Pin a specific in-repo image (relative path) as this repo's icon. The choice
/// is stored in app config, never written into the working tree.
pub fn set_repo_icon_override(
    app: &AppHandle,
    repo_path: &str,
    relative: &str,
) -> Result<(), String> {
    let relative = normalize_icon_href(relative);
    if read_icon_bytes(Path::new(repo_path), &relative).is_none() {
        return Err(format!("{relative} is not a readable image in this repository."));
    }

    let mut store = load_store(app, ICON_OVERRIDE_FILE)?;
    store.entries.insert(repo_path.to_string(), relative.clone());
    save_store(app, ICON_OVERRIDE_FILE, &store)?;
    set_cached_icon(app, repo_path, Some(&relative))
}

/// Drop a manual override and fall back to automatic detection.
pub fn clear_repo_icon_override(app: &AppHandle, repo_path: &str) -> Result<(), String> {
    let mut store = load_store(app, ICON_OVERRIDE_FILE)?;
    if store.entries.remove(repo_path).is_some() {
        save_store(app, ICON_OVERRIDE_FILE, &store)?;
    }
    warm_repo_icon_cache(app, repo_path)
}

pub fn warm_repo_icon_cache(app: &AppHandle, repo_path: &str) -> Result<(), String> {
    let repo_root = Path::new(repo_path);
    let relative = search_repo_icon(repo_root);
    set_cached_icon(app, repo_path, relative.as_deref())
}

pub fn clear_repo_icon_cache(app: &AppHandle, repo_path: &str) -> Result<(), String> {
    let mut overrides = load_store(app, ICON_OVERRIDE_FILE)?;
    if overrides.entries.remove(repo_path).is_some() {
        save_store(app, ICON_OVERRIDE_FILE, &overrides)?;
    }
    set_cached_icon(app, repo_path, None)
}

pub fn resolve_repo_icon(
    app: &AppHandle,
    repo_root: &Path,
    force_rescan: bool,
) -> Result<Option<String>, String> {
    let repo_path = repo_root.to_string_lossy().to_string();

    // A manual pick always wins, as long as the file is still there.
    if let Some(relative) = icon_override(app, &repo_path)? {
        if let Some(data_url) = read_icon_data_url(repo_root, &relative) {
            return Ok(Some(data_url));
        }
    }

    if !force_rescan {
        if let Some(relative) = load_store(app, ICON_CACHE_FILE)?.entries.get(&repo_path).cloned() {
            if let Some(data_url) = read_icon_data_url(repo_root, &relative) {
                return Ok(Some(data_url));
            }
        }
    }

    let relative = search_repo_icon(repo_root);
    set_cached_icon(app, &repo_path, relative.as_deref())?;

    Ok(relative.and_then(|path| read_icon_data_url(repo_root, &path)))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoImage {
    pub relative_path: String,
    pub data_url: String,
}

fn walk_for_images(
    dir: &Path,
    relative: &Path,
    depth: usize,
    scanned: &mut usize,
    found: &mut Vec<(i32, usize, String)>,
) {
    if depth > MAX_SEARCH_DEPTH || *scanned >= MAX_FILES_SCANNED {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if *scanned >= MAX_FILES_SCANNED {
            return;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if file_type.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            let next_relative = if relative.as_os_str().is_empty() {
                PathBuf::from(name.as_ref())
            } else {
                relative.join(name.as_ref())
            };
            walk_for_images(&entry.path(), &next_relative, depth + 1, scanned, found);
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        *scanned += 1;

        let path = entry.path();
        if image_mime_type(&path).is_none() {
            continue;
        }

        let size = fs::metadata(&path).ok().map(|meta| meta.len()).unwrap_or(0);
        if size == 0 || size > MAX_ICON_BYTES {
            continue;
        }

        let relative_path = if relative.as_os_str().is_empty() {
            name.to_string()
        } else {
            relative.join(name.as_ref()).to_string_lossy().to_string()
        };

        // Rank icon-shaped names first, then shallower files, so the most
        // likely picks lead the grid.
        let score = score_icon_filename(&name).unwrap_or(0) - (depth as i32) * 3;
        found.push((score, depth, relative_path));
    }
}

/// List candidate images inside the repo for the manual icon picker, best-first.
pub fn list_repo_images(repo_root: &Path) -> Vec<RepoImage> {
    let mut found = Vec::new();
    let mut scanned = 0;
    walk_for_images(repo_root, Path::new(""), 0, &mut scanned, &mut found);

    found.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });
    found.truncate(MAX_PICKER_IMAGES);

    found
        .into_iter()
        .filter_map(|(_, _, relative_path)| {
            read_icon_data_url(repo_root, &relative_path)
                .map(|data_url| RepoImage { relative_path, data_url })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn lock_test_dir() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn write_file(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn parses_favicon_href_from_index_html() {
        let _guard = lock_test_dir();
        let dir = std::env::temp_dir().join(format!("gitty-repo-icon-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        write_file(
            &dir.join("index.html"),
            br#"<html><head><link rel="icon" type="image/png" href="i/favicon.png"></head></html>"#,
        );
        write_file(&dir.join("i/favicon.png"), b"fake-png");

        let hrefs = favicon_hrefs_from_html(&dir.join("index.html"));
        assert_eq!(hrefs, vec!["i/favicon.png".to_string()]);
        assert_eq!(search_repo_icon(&dir).as_deref(), Some("i/favicon.png"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefers_gitty_override_over_html() {
        let _guard = lock_test_dir();
        let dir = std::env::temp_dir().join(format!("gitty-repo-icon-override-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir.join(".gitty")).unwrap();

        write_file(&dir.join(".gitty/icon.png"), b"override");
        write_file(
            &dir.join("index.html"),
            br#"<html><head><link rel="icon" href="i/favicon.png"></head></html>"#,
        );
        write_file(&dir.join("i/favicon.png"), b"html-icon");

        let icon = search_repo_icon(&dir).unwrap();
        assert_eq!(icon, ".gitty/icon.png");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_nested_app_icon_variants() {
        let _guard = lock_test_dir();
        let dir = std::env::temp_dir().join(format!("gitty-repo-icon-nested-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir.join("assets/branding")).unwrap();

        write_file(&dir.join("assets/branding/AppIcon.png"), b"app-icon");

        assert_eq!(
            search_repo_icon(&dir).as_deref(),
            Some("assets/branding/AppIcon.png")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_top_level_folder_app_icon() {
        let _guard = lock_test_dir();
        let dir = std::env::temp_dir().join(format!("gitty-repo-icon-marketing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir.join("marketing")).unwrap();

        // A distractor deeper in the tree that should lose to the top-level pick.
        write_file(&dir.join("src/assets/logo.png"), b"logo");
        write_file(&dir.join("marketing/app-icon.png"), b"app-icon");

        assert_eq!(
            search_repo_icon(&dir).as_deref(),
            Some("marketing/app-icon.png")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_large_top_level_app_icon() {
        let _guard = lock_test_dir();
        let dir = std::env::temp_dir().join(format!("gitty-repo-icon-large-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir.join("Marketing")).unwrap();

        // ~700KB, larger than the old 512KB cap — must still be picked up.
        write_file(&dir.join("Marketing/app-icon.png"), &vec![7u8; 700 * 1024]);

        assert_eq!(
            search_repo_icon(&dir).as_deref(),
            Some("Marketing/app-icon.png")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn weak_top_level_name_does_not_beat_deeper_favicon() {
        let _guard = lock_test_dir();
        let dir = std::env::temp_dir().join(format!("gitty-repo-icon-weak-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir.join("assets/icons")).unwrap();

        write_file(&dir.join("logo.png"), b"logo");
        write_file(&dir.join("assets/icons/favicon.png"), b"favicon");

        // A bare top-level "logo" is not confident enough to short-circuit the
        // full walk, so the stronger nested favicon still wins.
        assert_eq!(
            search_repo_icon(&dir).as_deref(),
            Some("assets/icons/favicon.png")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolves_kiddos_web_icon_when_present() {
        let path = Path::new("/Users/codi/Developer/Kiddos/kiddos_web");
        if !path.is_dir() {
            return;
        }

        assert!(
            search_repo_icon(path).is_some(),
            "expected a favicon for kiddos_web"
        );
    }
}
