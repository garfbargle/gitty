use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_auto_summarize_enabled")]
    pub auto_summarize_enabled: bool,
    #[serde(default)]
    pub push_on_commit: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nvidia_api_key: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_summarize_enabled: default_auto_summarize_enabled(),
            push_on_commit: false,
            nvidia_api_key: None,
        }
    }
}

fn default_auto_summarize_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsView {
    pub auto_summarize_enabled: bool,
    pub push_on_commit: bool,
    pub nvidia_api_key_configured: bool,
    pub nvidia_api_key_preview: Option<String>,
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not locate app config directory: {err}"))?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Could not create config directory {}: {err}", dir.display()))?;
    Ok(dir.join(SETTINGS_FILE))
}

pub fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_file(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let data = fs::read_to_string(&path)
        .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
    serde_json::from_str(&data).map_err(|err| format!("Could not parse {}: {err}", path.display()))
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_file(app)?;
    let data = serde_json::to_string_pretty(settings)
        .map_err(|err| format!("Could not serialize settings: {err}"))?;
    fs::write(&path, data).map_err(|err| format!("Could not write {}: {err}", path.display()))
}

pub fn settings_view(app: &AppHandle) -> Result<AppSettingsView, String> {
    let settings = load_settings(app)?;
    let nvidia_api_key_configured = settings
        .nvidia_api_key
        .as_ref()
        .is_some_and(|key| !normalize_nvidia_api_key(key).is_empty());

    Ok(AppSettingsView {
        auto_summarize_enabled: settings.auto_summarize_enabled,
        push_on_commit: settings.push_on_commit,
        nvidia_api_key_configured,
        nvidia_api_key_preview: settings
            .nvidia_api_key
            .as_ref()
            .filter(|_| nvidia_api_key_configured)
            .map(|key| mask_nvidia_api_key(key)),
    })
}

pub fn normalize_nvidia_api_key(key: &str) -> String {
    let key = key
        .trim()
        .trim_start_matches("Bearer ")
        .trim_start_matches("bearer ")
        .trim();
    key.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<String>()
}

pub fn mask_nvidia_api_key(key: &str) -> String {
    let key = normalize_nvidia_api_key(key);
    if key.len() <= 12 {
        return "nvapi-••••••••".to_string();
    }
    format!("{}••••{}", &key[..7], &key[key.len() - 4..])
}

pub fn nvidia_api_key(app: &AppHandle) -> Result<String, String> {
    let settings = load_settings(app)?;
    let key = settings
        .nvidia_api_key
        .as_ref()
        .map(|key| normalize_nvidia_api_key(key))
        .unwrap_or_default();
    if key.is_empty() {
        return Err("Add your NVIDIA API key to auto-summarize changes.".to_string());
    }
    Ok(key)
}
