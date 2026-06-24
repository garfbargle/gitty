use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const ICON_CACHE_FILE: &str = "repo-icon-cache.json";
const MAX_ICON_BYTES: u64 = 512 * 1024;
const MAX_SEARCH_DEPTH: usize = 6;
const MAX_FILES_SCANNED: usize = 2500;

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

fn icon_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not locate app config directory: {err}"))?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Could not create config directory {}: {err}", dir.display()))?;
    Ok(dir.join(ICON_CACHE_FILE))
}

fn load_icon_cache(app: &AppHandle) -> Result<IconCacheStore, String> {
    let path = icon_cache_path(app)?;
    if !path.exists() {
        return Ok(IconCacheStore::default());
    }

    let data = fs::read_to_string(&path)
        .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
    serde_json::from_str(&data).map_err(|err| format!("Could not parse {}: {err}", path.display()))
}

fn save_icon_cache(app: &AppHandle, cache: &IconCacheStore) -> Result<(), String> {
    let path = icon_cache_path(app)?;
    let data = serde_json::to_string_pretty(cache)
        .map_err(|err| format!("Could not serialize icon cache: {err}"))?;
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

fn search_icons_in_tree(repo_root: &Path) -> Option<String> {
    let mut candidates = Vec::new();
    let mut scanned = 0;
    walk_for_icon_candidates(repo_root, repo_root, Path::new(""), 0, &mut scanned, &mut candidates);

    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.depth.cmp(&right.depth))
            .then_with(|| left.size.cmp(&right.size))
    });

    candidates.into_iter().next().map(|candidate| candidate.relative_path)
}

pub fn search_repo_icon(repo_root: &Path) -> Option<String> {
    search_gitty_override(repo_root)
        .or_else(|| search_icons_from_html(repo_root))
        .or_else(|| search_icons_in_tree(repo_root))
}

fn set_cached_icon(app: &AppHandle, repo_path: &str, relative: Option<&str>) -> Result<(), String> {
    let mut cache = load_icon_cache(app)?;
    match relative {
        Some(path) => {
            cache.entries.insert(repo_path.to_string(), path.to_string());
        }
        None => {
            cache.entries.remove(repo_path);
        }
    }
    save_icon_cache(app, &cache)
}

pub fn warm_repo_icon_cache(app: &AppHandle, repo_path: &str) -> Result<(), String> {
    let repo_root = Path::new(repo_path);
    let relative = search_repo_icon(repo_root);
    set_cached_icon(app, repo_path, relative.as_deref())
}

pub fn clear_repo_icon_cache(app: &AppHandle, repo_path: &str) -> Result<(), String> {
    set_cached_icon(app, repo_path, None)
}

pub fn resolve_repo_icon(
    app: &AppHandle,
    repo_root: &Path,
    force_rescan: bool,
) -> Result<Option<String>, String> {
    let repo_path = repo_root.to_string_lossy().to_string();

    if !force_rescan {
        if let Some(relative) = load_icon_cache(app)?.entries.get(&repo_path).cloned() {
            if let Some(data_url) = read_icon_data_url(repo_root, &relative) {
                return Ok(Some(data_url));
            }
        }
    }

    let relative = search_repo_icon(repo_root);
    set_cached_icon(app, &repo_path, relative.as_deref())?;

    Ok(relative.and_then(|path| read_icon_data_url(repo_root, &path)))
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
