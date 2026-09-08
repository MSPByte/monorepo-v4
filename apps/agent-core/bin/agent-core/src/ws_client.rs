use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::RwLock;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use agent_ipc::PendingEventEntry;

use crate::config::Config;
use crate::logger::{info, logwarn};
use crate::state::State;

pub type EventsQueue = Arc<tokio::sync::Mutex<Vec<PendingEventEntry>>>;

pub fn new_events_queue() -> EventsQueue {
    Arc::new(tokio::sync::Mutex::new(Vec::new()))
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
enum ServerEvent {
    BundleUpdated {
        #[serde(default)]
        etag: Option<String>,
    },
    TicketNoteAdded {
        ticket_id: String,
    },
    TicketStatusChanged {
        ticket_id: String,
        status_name: String,
    },
    Ping,
}

pub async fn run_ws_loop(cfg: Config, root: PathBuf, state: Arc<RwLock<State>>, events: EventsQueue) {
    const MAX_BACKOFF: u64 = 60;
    let mut backoff: u64 = 5;

    loop {
        // Wait for enrollment before attempting to connect.
        let device_id = {
            let s = state.read().await;
            s.device_id.clone()
        };

        let device_id = match device_id {
            Some(id) => id,
            None => {
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        let ws_url = make_ws_url(&cfg.agent.server_url);

        match connect_once(&ws_url, &device_id, &cfg, &root, &state, &events).await {
            Ok(()) => {
                info!("WS: connection closed cleanly, reconnecting in 5s");
                backoff = 5;
            }
            Err(e) => {
                logwarn!("WS: connection error: {:#}, retrying in {}s", e, backoff);
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        }

        tokio::time::sleep(Duration::from_secs(backoff)).await;
    }
}

fn make_ws_url(server_url: &str) -> String {
    let base = if server_url.starts_with("https://") {
        server_url.replacen("https://", "wss://", 1)
    } else {
        server_url.replacen("http://", "ws://", 1)
    };
    format!("{}/v2.0/ws", base.trim_end_matches('/'))
}

async fn connect_once(
    ws_url: &str,
    device_id: &str,
    cfg: &Config,
    root: &PathBuf,
    state: &Arc<RwLock<State>>,
    events: &EventsQueue,
) -> anyhow::Result<()> {
    let mut request = ws_url.into_client_request()?;
    {
        let headers = request.headers_mut();
        headers.insert("x-device-id", HeaderValue::from_str(device_id)?);
        headers.insert("x-org-id", HeaderValue::from_str(&cfg.agent.org_id)?);
    }

    let (ws_stream, _) = connect_async(request).await?;
    let (mut sink, mut stream) = ws_stream.split();

    info!("WS: connected to {}", ws_url);

    let mut ping_interval = tokio::time::interval(Duration::from_secs(30));
    ping_interval.tick().await; // consume first immediate tick

    loop {
        tokio::select! {
            _ = ping_interval.tick() => {
                sink.send(Message::Ping(vec![].into())).await?;
            }
            msg = stream.next() => {
                match msg {
                    None => return Ok(()),
                    Some(Err(e)) => return Err(e.into()),
                    Some(Ok(Message::Close(_))) => return Ok(()),
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Ping(data))) => {
                        sink.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Text(text))) => {
                        handle_event(text.as_str(), cfg, root, state, events).await;
                    }
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}

async fn handle_event(
    text: &str,
    cfg: &Config,
    root: &PathBuf,
    state: &Arc<RwLock<State>>,
    events: &EventsQueue,
) {
    let event: ServerEvent = match serde_json::from_str(text) {
        Ok(e) => e,
        Err(e) => {
            logwarn!("WS: unrecognised event — {}: {}", e, text);
            return;
        }
    };

    match event {
        ServerEvent::BundleUpdated { etag } => {
            info!("WS: bundle_updated — refreshing bundle immediately");
            let mut s = state.write().await;
            match crate::bundle::fetch(cfg, root, &mut s).await {
                Ok(_) => {
                    crate::state::save(root, &s).ok();
                    info!("WS: bundle refreshed, etag={:?}", s.bundle_etag);
                    events.lock().await.push(PendingEventEntry::BundleUpdated { etag });
                }
                Err(e) => {
                    logwarn!("WS: bundle refresh failed: {:#}", e);
                }
            }
        }
        ServerEvent::TicketNoteAdded { ticket_id } => {
            info!("WS: ticket_note_added ticket_id={}", ticket_id);
            events.lock().await.push(PendingEventEntry::TicketNoteAdded { ticket_id });
        }
        ServerEvent::TicketStatusChanged { ticket_id, status_name } => {
            info!("WS: ticket_status_changed ticket_id={} status={}", ticket_id, status_name);
            events.lock().await.push(PendingEventEntry::TicketStatusChanged { ticket_id, status_name });
        }
        ServerEvent::Ping => {}
    }
}
