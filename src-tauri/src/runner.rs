use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoAction {
    pub id: String,
    pub name: String,
    pub command: String,
    pub category: String, // "npm" | "cargo" | "make" | "script" | "custom"
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutputPayload {
    pub action_id: String,
    pub line: String,
    pub stream: String, // "stdout" | "stderr"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionFinishedPayload {
    pub action_id: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

/// Detect capabilities and actionable commands for a repository at `path`.
#[tauri::command]
pub fn detect_repo_actions(path: String) -> Vec<RepoAction> {
    let mut actions = Vec::new();
    let root = Path::new(&path);

    if !root.exists() || !root.is_dir() {
        return actions;
    }

    // 1. Detect package.json scripts (npm, pnpm, yarn, bun)
    let package_json = root.join("package.json");
    if package_json.exists() {
        if let Ok(content) = fs::read_to_string(&package_json) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let pkg_mgr = if root.join("pnpm-lock.yaml").exists() {
                    "pnpm"
                } else if root.join("yarn.lock").exists() {
                    "yarn"
                } else if root.join("bun.lock").exists() || root.join("bun.lockb").exists() {
                    "bun"
                } else {
                    "npm"
                };

                if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                    for (script_name, val) in scripts {
                        let cmd_str = val.as_str().unwrap_or("");
                        let run_cmd = match pkg_mgr {
                            "pnpm" => format!("pnpm {}", script_name),
                            "yarn" => format!("yarn {}", script_name),
                            "bun" => format!("bun run {}", script_name),
                            _ => format!("npm run {}", script_name),
                        };

                        let desc = if !cmd_str.is_empty() {
                            Some(cmd_str.to_string())
                        } else {
                            None
                        };

                        actions.push(RepoAction {
                            id: format!("npm:{}", script_name),
                            name: format!("{} {}", pkg_mgr, script_name),
                            command: run_cmd,
                            category: "npm".to_string(),
                            description: desc,
                        });
                    }
                }
            }
        }
    }

    // 2. Detect Cargo.toml (Rust)
    let cargo_toml = root.join("Cargo.toml");
    if cargo_toml.exists() {
        actions.push(RepoAction {
            id: "cargo:check".to_string(),
            name: "cargo check".to_string(),
            command: "cargo check".to_string(),
            category: "cargo".to_string(),
            description: Some("Check the current package for errors".to_string()),
        });
        actions.push(RepoAction {
            id: "cargo:build".to_string(),
            name: "cargo build".to_string(),
            command: "cargo build".to_string(),
            category: "cargo".to_string(),
            description: Some("Compile the current package".to_string()),
        });
        actions.push(RepoAction {
            id: "cargo:test".to_string(),
            name: "cargo test".to_string(),
            command: "cargo test".to_string(),
            category: "cargo".to_string(),
            description: Some("Execute unit & integration tests".to_string()),
        });
        actions.push(RepoAction {
            id: "cargo:run".to_string(),
            name: "cargo run".to_string(),
            command: "cargo run".to_string(),
            category: "cargo".to_string(),
            description: Some("Run a binary of the package".to_string()),
        });
    }

    // 3. Detect Makefile
    let makefile = if root.join("Makefile").exists() {
        Some(root.join("Makefile"))
    } else if root.join("makefile").exists() {
        Some(root.join("makefile"))
    } else {
        None
    };

    if let Some(mf_path) = makefile {
        if let Ok(content) = fs::read_to_string(mf_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') || trimmed.starts_with('.') || trimmed.is_empty() {
                    continue;
                }
                if let Some(colon_idx) = trimmed.find(':') {
                    let target = trimmed[..colon_idx].trim();
                    if !target.contains(' ')
                        && !target.contains('$')
                        && !target.contains('=')
                        && !target.is_empty()
                        && target != "PHONY"
                    {
                        actions.push(RepoAction {
                            id: format!("make:{}", target),
                            name: format!("make {}", target),
                            command: format!("make {}", target),
                            category: "make".to_string(),
                            description: Some(format!("Run Makefile target '{}'", target)),
                        });
                    }
                }
            }
        }
    }

    // 4. Detect executable / shell scripts in ./scripts directory
    let scripts_dir = root.join("scripts");
    if scripts_dir.exists() && scripts_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&scripts_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext == "sh" || ext == "ps1" {
                            let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                            let rel_path = format!("scripts/{}", file_name);
                            let run_cmd = if ext == "sh" {
                                format!("bash {}", rel_path)
                            } else {
                                format!("powershell -File {}", rel_path)
                            };

                            actions.push(RepoAction {
                                id: format!("script:{}", file_name),
                                name: rel_path.clone(),
                                command: run_cmd,
                                category: "script".to_string(),
                                description: Some(format!("Execute script {}", rel_path)),
                            });
                        }
                    }
                }
            }
        }
    }

    actions
}

/// Execute a repository command asynchronously, streaming output lines back to frontend.
#[tauri::command]
pub fn execute_repo_action(
    app: AppHandle,
    path: String,
    action_id: String,
    command: String,
) -> Result<(), String> {
    if path.is_empty() || command.is_empty() {
        return Err("Invalid path or command".to_string());
    }

    let root = Path::new(&path);
    if !root.exists() {
        return Err(format!("Repository path does not exist: {}", path));
    }

    let app_handle = app.clone();
    let action_id_clone = action_id.clone();
    let path_buf = root.to_path_buf();

    thread::spawn(move || {
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&command);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg("-c").arg(&command);
            c
        };

        cmd.current_dir(&path_buf);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Ensure PATH includes common dev tools (e.g. node, cargo, homebrew)
        if let Ok(existing_path) = std::env::var("PATH") {
            let extra_paths = "/usr/local/bin:/opt/homebrew/bin:~/.cargo/bin:~/.nvm/versions/node";
            cmd.env("PATH", format!("{}:{}", extra_paths, existing_path));
        }

        match cmd.spawn() {
            Ok(mut child) => {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                let app_out = app_handle.clone();
                let act_id_out = action_id_clone.clone();

                let stdout_thread = thread::spawn(move || {
                    if let Some(out) = stdout {
                        let reader = BufReader::new(out);
                        for line in reader.lines().flatten() {
                            let _ = app_out.emit(
                                "action-runner-output",
                                ActionOutputPayload {
                                    action_id: act_id_out.clone(),
                                    line,
                                    stream: "stdout".to_string(),
                                },
                            );
                        }
                    }
                });

                let app_err = app_handle.clone();
                let act_id_err = action_id_clone.clone();

                let stderr_thread = thread::spawn(move || {
                    if let Some(err) = stderr {
                        let reader = BufReader::new(err);
                        for line in reader.lines().flatten() {
                            let _ = app_err.emit(
                                "action-runner-output",
                                ActionOutputPayload {
                                    action_id: act_id_err.clone(),
                                    line,
                                    stream: "stderr".to_string(),
                                },
                            );
                        }
                    }
                });

                let status = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();

                let (success, exit_code) = match status {
                    Ok(s) => (s.success(), s.code()),
                    Err(_) => (false, None),
                };

                let _ = app_handle.emit(
                    "action-runner-finished",
                    ActionFinishedPayload {
                        action_id: action_id_clone,
                        success,
                        exit_code,
                        error: if !success {
                            Some("Process exited with non-zero code".to_string())
                        } else {
                            None
                        },
                    },
                );
            }
            Err(err) => {
                let _ = app_handle.emit(
                    "action-runner-finished",
                    ActionFinishedPayload {
                        action_id: action_id_clone,
                        success: false,
                        exit_code: None,
                        error: Some(format!("Failed to spawn command: {}", err)),
                    },
                );
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    #[test]
    fn test_detect_package_json_scripts() {
        let dir = std::env::temp_dir().join(format!("gitty-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        let pkg_path = dir.join("package.json");
        let mut file = File::create(&pkg_path).unwrap();
        writeln!(
            file,
            r#"{{
            "name": "test-pkg",
            "scripts": {{
                "dev": "vite",
                "build": "tsc && vite build",
                "tauri build": "tauri build"
            }}
        }}"#
        )
        .unwrap();

        let actions = detect_repo_actions(dir.to_string_lossy().to_string());
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(actions.len(), 3);
        assert!(actions.iter().any(|a| a.command == "npm run dev"));
        assert!(actions.iter().any(|a| a.command == "npm run build"));
        assert!(actions.iter().any(|a| a.command == "npm run tauri build"));
    }

    #[test]
    fn test_detect_cargo_toml() {
        let dir = std::env::temp_dir().join(format!("gitty-test-cargo-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        let cargo_path = dir.join("Cargo.toml");
        let mut file = File::create(&cargo_path).unwrap();
        writeln!(file, r#"[package]\nname = "test-crate""#).unwrap();

        let actions = detect_repo_actions(dir.to_string_lossy().to_string());
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(actions.len(), 4);
        assert!(actions.iter().any(|a| a.command == "cargo check"));
        assert!(actions.iter().any(|a| a.command == "cargo build"));
        assert!(actions.iter().any(|a| a.command == "cargo test"));
        assert!(actions.iter().any(|a| a.command == "cargo run"));
    }
}
