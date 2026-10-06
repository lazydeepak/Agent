use std::sync::Mutex;
use tauri::Manager;

mod sidecar;
use sidecar::{SidecarConfig, SidecarManager};

pub struct ManagedLocalState {
    manager: Mutex<SidecarManager>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ManagedLocalState {
            manager: Mutex::new(SidecarManager::new(SidecarConfig {
                node_path: String::new(),
                bundle_path: String::new(),
                token: format!("ephemeral-{}", std::process::id()),
                config_path: None,
                db_path: None,
            })),
        })
        .invoke_handler(tauri::generate_handler![
            get_connection_context,
            restart_local_service,
            get_managed_service_state,
            start_managed_service
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<ManagedLocalState>();
                let mut mgr = state.manager.lock().unwrap();
                let _ = mgr.shutdown();
            }
        })
        .setup(|app| {
            let state = app.state::<ManagedLocalState>();
            let mut mgr = state.manager.lock().unwrap();

            let runtime = resolve_runtime_paths();
            let token = format!("ephemeral-{}", std::process::id());

            let cfg = SidecarConfig {
                node_path: runtime.node_path,
                bundle_path: runtime.bundle_path,
                token: token.clone(),
                config_path: runtime.config_path,
                db_path: runtime.db_path,
            };

            if let Err(e) = mgr.start(cfg) {
                eprintln!("Failed to start managed local service: {}", e);
                return Ok(());
            }

            // Wait for readiness with bounded timeout (15 seconds).
            let result = mgr.observe_readiness(15_000);
            if result.ready {
                println!(
                    "Managed Local ready at {}",
                    result.endpoint.as_deref().unwrap_or("unknown")
                );
            } else {
                eprintln!(
                    "Managed Local readiness failed: {}",
                    result.error.unwrap_or_else(|| "unknown".into())
                );
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}

#[tauri::command]
fn get_connection_context(app_handle: tauri::AppHandle) -> Option<serde_json::Value> {
    let state = app_handle.state::<ManagedLocalState>();
    let mgr = state.manager.lock().unwrap();
    let s = mgr.get_state();
    if s.ready && s.running {
        Some(serde_json::json!({
            "endpoint": s.endpoint.unwrap_or_else(|| "http://127.0.0.1:8181".into()),
            "token": s.token.unwrap_or_default(),
        }))
    } else {
        None
    }
}

#[tauri::command]
fn start_managed_service(app_handle: tauri::AppHandle) -> String {
    let state = app_handle.state::<ManagedLocalState>();
    let mut mgr = state.manager.lock().unwrap();
    if mgr.get_state().running {
        return "Managed Local already running (single-flight).".into();
    }

    let runtime = resolve_runtime_paths();
    let token = format!("ephemeral-{}", std::process::id());
    let cfg = SidecarConfig {
        node_path: runtime.node_path,
        bundle_path: runtime.bundle_path,
        token,
        config_path: runtime.config_path,
        db_path: runtime.db_path,
    };
    match mgr.start(cfg) {
        Ok(()) => "Managed Local Starting...".into(),
        Err(e) => format!("Failed to start: {}", e),
    }
}

#[tauri::command]
fn restart_local_service(app_handle: tauri::AppHandle) -> String {
    let state = app_handle.state::<ManagedLocalState>();
    let mut mgr = state.manager.lock().unwrap();
    let _ = mgr.shutdown();

    let runtime = resolve_runtime_paths();
    let token = format!("ephemeral-{}", std::process::id());
    let cfg = SidecarConfig {
        node_path: runtime.node_path,
        bundle_path: runtime.bundle_path,
        token,
        config_path: runtime.config_path,
        db_path: runtime.db_path,
    };
    match mgr.start(cfg) {
        Ok(()) => "Managed Local Restarting...".into(),
        Err(e) => format!("Restart failed: {}", e),
    }
}

#[tauri::command]
fn get_managed_service_state(app_handle: tauri::AppHandle) -> String {
    let state = app_handle.state::<ManagedLocalState>();
    let mgr = state.manager.lock().unwrap();
    let s = mgr.get_state();
    format!(
        "Managed Local {{ running: {}, ready: {}, endpoint: {:?}, token_set: {}, restart_attempts: {}, budget_exhausted: {} }}",
        s.running,
        s.ready,
        s.endpoint,
        s.token.is_some(),
        s.restart_attempts,
        s.restart_budget_exhausted
    )
}

/// Runtime paths resolved for the managed sidecar.
pub struct RuntimePaths {
    pub node_path: String,
    pub bundle_path: String,
    pub config_path: Option<String>,
    pub db_path: Option<String>,
}

/// Resolve the packaged private Node runtime and the service bundle path.
/// - Dev (`cargo tauri dev` / `cargo run`): resolves relative to CARGO_MANIFEST_DIR.
/// - Production (macOS .app bundle): resolves under Contents/Resources/agent-relay-runtime.
/// - Explicit environment overrides always win.
fn resolve_runtime_paths() -> RuntimePaths {
    if let (Ok(node), Ok(bundle)) = (
        std::env::var("RELAY_MANAGED_NODE_PATH"),
        std::env::var("RELAY_MANAGED_BUNDLE_PATH"),
    ) {
        return RuntimePaths {
            node_path: node,
            bundle_path: bundle,
            config_path: std::env::var("RELAY_MANAGED_CONFIG_PATH").ok(),
            db_path: std::env::var("RELAY_MANAGED_DB_PATH").ok(),
        };
    }

    // Production: executable lives in <App>.app/Contents/MacOS/, runtime in
    // <App>.app/Contents/Resources/agent-relay-runtime/.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            let exe_name = macos_dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if exe_name == "MacOS" {
                let resources = macos_dir.parent().map(|d| d.join("Resources/agent-relay-runtime"));
                if let Some(res) = resources {
                    return RuntimePaths {
                        node_path: res.join("node").to_string_lossy().into_owned(),
                        bundle_path: res.join("service.bundle.cjs").to_string_lossy().into_owned(),
                        config_path: Some(res.join("config/pairs.local.json").to_string_lossy().into_owned()),
                        db_path: Some(res.join("data/agent-relay.sqlite").to_string_lossy().into_owned()),
                    };
                }
            }
        }
    }

    // Dev: CARGO_MANIFEST_DIR is <repo>/tauri-client/src-tauri.
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let node = manifest.join("bin/node").to_string_lossy().into_owned();
    let bundle = manifest.join("../../dist/service/service.bundle.cjs").to_string_lossy().into_owned();
    let repo = manifest.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf());
    let config_path = repo.as_ref().map(|r| r.join("config/pairs.local.json").to_string_lossy().into_owned());
    let db_path = repo.as_ref().map(|r| r.join("data/agent-relay.sqlite").to_string_lossy().into_owned());
    RuntimePaths {
        node_path: node,
        bundle_path: bundle,
        config_path,
        db_path,
    }
}