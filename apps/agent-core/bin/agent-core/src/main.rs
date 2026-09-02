mod checkin;
mod config;
mod logger;
mod server;
mod state;

use std::{sync::Arc, time::Duration};
use tokio::sync::RwLock;

use agent_platform::{is_privileged, root_path, socket_path};
use logger::{info, logerr};

#[tokio::main]
async fn main() {
    let root = root_path();

    logger::init(&root);

    info!("agent-core {} starting", env!("CARGO_PKG_VERSION"));

    if !is_privileged() {
        logerr!("agent-core must run as root/SYSTEM. Exiting.");
        std::process::exit(1);
    }

    // Ensure root directory exists.
    if let Err(e) = std::fs::create_dir_all(&root) {
        logerr!("Cannot create root dir {}: {}", root.display(), e);
        std::process::exit(1);
    }

    let cfg = match config::load(&root) {
        Ok(c) => c,
        Err(e) => {
            logerr!("Config load failed: {}", e);
            std::process::exit(1);
        }
    };

    let initial_state = state::load(&root);
    let shared_state = Arc::new(RwLock::new(initial_state));

    let checkin_state = shared_state.clone();
    let checkin_cfg = cfg.clone();
    let checkin_root = root.clone();
    tokio::spawn(async move {
        checkin::run_checkin_loop(checkin_cfg, checkin_root, checkin_state, Duration::from_secs(300)).await;
    });

    server::run_ipc_server(socket_path(), shared_state).await;
}
