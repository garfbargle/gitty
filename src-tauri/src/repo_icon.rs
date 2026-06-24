use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::Path;

const MAX_ICON_BYTES: u64 = 512 * 1024;

const REPO_ICON_CANDIDATES: &[&str] = &[
    ".gitty/icon.png",
    ".gitty/icon.svg",
    ".gitty/icon.ico",
    ".gitty/logo.png",
    ".gitty/logo.svg",
    "favicon.ico",
    "favicon.png",
    "favicon.svg",
    "icon.png",
    "logo.png",
    "logo.svg",
    "appicon.png",
    "AppIcon.png",
    "apple-touch-icon.png",
    "public/favicon.ico",
    "public/favicon.png",
    "public/favicon.svg",
    "public/icon.png",
    "public/logo.png",
    "public/logo.svg",
    "public/apple-touch-icon.png",
    "app/favicon.ico",
    "app/icon.png",
    "app/icon.svg",
    "src/app/favicon.ico",
    "src/app/icon.png",
    "src/app/icon.svg",
    "static/favicon.ico",
    "static/icon.png",
    "static/logo.png",
    "assets/icon.png",
    "assets/logo.png",
    "assets/logo.svg",
    "assets/favicon.ico",
    "src-tauri/icons/icon.png",
    "src-tauri/icons/32x32.png",
    "src-tauri/icons/128x128.png",
    "icons/icon.png",
    "resources/icon.png",
    "resources/app.png",
];

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

fn read_icon_file(repo_root: &Path, relative: &str) -> Option<String> {
    let file_path = repo_root.join(relative);
    if !file_path.is_file() {
        return None;
    }

    let metadata = std::fs::metadata(&file_path).ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_ICON_BYTES {
        return None;
    }

    let mime = image_mime_type(&file_path)?;
    let bytes = std::fs::read(&file_path).ok()?;
    if bytes.is_empty() {
        return None;
    }

    Some(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(bytes)
    ))
}

pub fn resolve_repo_icon_data_url(repo_root: &Path) -> Option<String> {
    for candidate in REPO_ICON_CANDIDATES {
        if let Some(data_url) = read_icon_file(repo_root, candidate) {
            return Some(data_url);
        }
    }
    None
}
