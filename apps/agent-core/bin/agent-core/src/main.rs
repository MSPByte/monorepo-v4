mod bundle;
mod checkin;
mod config;
mod logger;
mod server;
mod state;
mod update;
mod ws_client;

use std::{sync::Arc, time::Duration};
use tokio::sync::RwLock;

use agent_platform::{is_privileged, root_path, socket_path};
use logger::{info, logerr};

#[tokio::main]
async fn main() {
    let root = root_path();
    let dev_mode = std::env::var("MSPAGENT_DEV").as_deref() == Ok("1");

    // Apply any staged update before logging or doing anything else.
    // Skip in dev mode — the binary swap would overwrite the dev build.
    if !dev_mode {
        update::apply_pending(&root);
    }

    if let Err(e) = std::fs::create_dir_all(&root) {
        eprintln!("Cannot create root dir {}: {}", root.display(), e);
        std::process::exit(1);
    }

    // Detect version change before opening the log so we can rotate it first.
    let mut initial_state = state::load(&root);
    let current_version = env!("CARGO_PKG_VERSION");
    let version_changed = initial_state.last_version.as_deref() != Some(current_version);

    logger::init(&root, version_changed);

    if version_changed {
        logger::install_log(&root, &format!("=== upgrade: {:?} → {} ===",
            initial_state.last_version, current_version));
        initial_state.last_version = Some(current_version.to_string());
        state::save(&root, &initial_state).ok();
    }

    info!("agent-core {} starting", current_version);

    if !is_privileged() {
        logerr!("agent-core must run as root/SYSTEM. Exiting.");
        std::process::exit(1);
    }

    let cfg = match config::load(&root) {
        Ok(c) => c,
        Err(e) => {
            logerr!("Config load failed: {}", e);
            std::process::exit(1);
        }
    };

    let shared_state = Arc::new(RwLock::new(initial_state));
    let events_queue = ws_client::new_events_queue();

    let checkin_state = shared_state.clone();
    let checkin_cfg = cfg.clone();
    let checkin_root = root.clone();
    tokio::spawn(async move {
        checkin::run_checkin_loop(
            checkin_cfg,
            checkin_root,
            checkin_state,
            Duration::from_secs(300),
        )
        .await;
    });

    let ws_state = shared_state.clone();
    let ws_cfg = cfg.clone();
    let ws_root = root.clone();
    let ws_events = events_queue.clone();
    tokio::spawn(async move {
        ws_client::run_ws_loop(ws_cfg, ws_root, ws_state, ws_events).await;
    });

    server::run_ipc_server(socket_path(), root, cfg, shared_state, events_queue).await;
}
