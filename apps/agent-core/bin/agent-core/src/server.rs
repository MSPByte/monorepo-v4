use agent_ipc::{
    ConfigBundlePayload, Envelope, ErrorPayload, IpcListener, Message, OsUserPayload,
    StatusPayload,
};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::RwLock;

use crate::{
    logger::{info, logerr},
    state::State,
};

pub async fn run_ipc_server(socket_path: PathBuf, state: Arc<RwLock<State>>) {
    let listener = match IpcListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            logerr!("IPC bind failed: {}", e);
            return;
        }
    };
    info!("IPC server listening on {}", socket_path.display());

    loop {
        match listener.accept().await {
            Ok(conn) => {
                let state = state.clone();
                tokio::spawn(async move {
                    let _ = conn
                        .handle(|req| async move { dispatch(req, state).await })
                        .await;
                });
            }
            Err(e) => {
                logerr!("IPC accept error: {}", e);
            }
        }
    }
}

async fn dispatch(req: Envelope, state: Arc<RwLock<State>>) -> Envelope {
    let s = state.read().await;
    match &req.message {
        Message::Ping => req.reply(Message::Pong),

        Message::GetStatus => {
            let enrolled = s.device_id.is_some();
            req.reply(Message::Status(StatusPayload {
                enrolled,
                version: env!("CARGO_PKG_VERSION").to_string(),
                device_id: s.device_id.clone(),
                last_checkin_at: None,
                bundle_etag: s.bundle_etag.clone(),
                bundle_offline: false,
            }))
        }

        Message::GetConfigBundle => req.reply(Message::ConfigBundle(ConfigBundlePayload {
            etag: s.bundle_etag.clone(),
            fetched_at: s.bundle_fetched_at.map(|dt| dt.to_rfc3339()),
            offline: false,
            bundle: None,
        })),

        Message::GetOsUser => {
            let username = whoami::username();
            req.reply(Message::OsUser(OsUserPayload {
                username,
                sid: None,
                display_name: None,
            }))
        }

        Message::SubmitForm(_) => req.reply(Message::Error(ErrorPayload {
            code: "not_implemented".into(),
            message: "SubmitForm requires Phase 4".into(),
        })),

        _ => req.reply(Message::Error(ErrorPayload {
            code: "unexpected_message".into(),
            message: format!("agent-core received unexpected message kind"),
        })),
    }
}
