use agent_ipc::{
    ConfigBundlePayload, Envelope, ErrorPayload, IpcListener, Message,
    OsUserPayload, PendingEventsPayload, StatusPayload, SubmitFormAckPayload,
    TicketActionSummary, TicketDetailPayload, TicketListPayload, TicketNoteAckPayload, TicketSummary,
};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::RwLock;

use crate::ws_client::EventsQueue;

use crate::{
    bundle::load_cached,
    config::Config,
    logger::{info, logerr},
    state::State,
};

pub async fn run_ipc_server(
    socket_path: PathBuf,
    root: PathBuf,
    cfg: Config,
    state: Arc<RwLock<State>>,
    events: EventsQueue,
) {
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
                let root = root.clone();
                let cfg = cfg.clone();
                let events = events.clone();
                tokio::spawn(async move {
                    let _ = conn
                        .handle(|req| async move { dispatch(req, root, cfg, state, events).await })
                        .await;
                });
            }
            Err(e) => {
                logerr!("IPC accept error: {}", e);
            }
        }
    }
}

async fn dispatch(req: Envelope, root: PathBuf, cfg: Config, state: Arc<RwLock<State>>, events: EventsQueue) -> Envelope {
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

        Message::GetConfigBundle => {
            let cached = load_cached(&root);
            req.reply(Message::ConfigBundle(ConfigBundlePayload {
                etag: s.bundle_etag.clone(),
                fetched_at: s.bundle_fetched_at.map(|dt| dt.to_rfc3339()),
                offline: false,
                bundle: cached,
            }))
        }

        Message::GetOsUser => {
            let username = whoami::username();
            req.reply(Message::OsUser(OsUserPayload {
                username,
                sid: None,
                display_name: None,
            }))
        }

        Message::SubmitForm(payload) => {
            let device_id = match &s.device_id {
                Some(id) => id.clone(),
                None => {
                    return req.reply(Message::Error(ErrorPayload {
                        code: "not_enrolled".into(),
                        message: "Device is not enrolled".into(),
                    }));
                }
            };
            // Drop the read lock before the async HTTP call.
            drop(s);

            let url = format!("{}/v2.0/submit", cfg.agent.server_url);
            let client = reqwest::Client::new();
            match client
                .post(&url)
                .header("X-Device-ID", &device_id)
                .header("X-Org-ID", &cfg.agent.org_id)
                .json(payload)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    let body: serde_json::Value = resp.json().await.unwrap_or_default();
                    let ticket_id = body["data"]["ticket_id"].as_str().map(str::to_string);
                    req.reply(Message::SubmitFormAck(SubmitFormAckPayload {
                        accepted: true,
                        message: "Ticket created".into(),
                        submission_id: ticket_id,
                    }))
                }
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    req.reply(Message::Error(ErrorPayload {
                        code: "submit_error".into(),
                        message: format!("Server returned {}", status),
                    }))
                }
                Err(e) => req.reply(Message::Error(ErrorPayload {
                    code: "submit_error".into(),
                    message: format!("Request failed: {}", e),
                })),
            }
        }

        Message::GetTickets(payload) => {
            let sid = payload.os_user_sid.clone();
            let device_id = match &s.device_id {
                Some(id) => id.clone(),
                None => return req.reply(Message::Error(ErrorPayload {
                    code: "not_enrolled".into(),
                    message: "Device is not enrolled".into(),
                })),
            };
            drop(s);
            let client = reqwest::Client::new();
            let mut rb = client
                .get(format!("{}/v2.0/tickets", cfg.agent.server_url))
                .header("X-Device-ID", &device_id)
                .header("X-Org-ID", &cfg.agent.org_id);
            if let Some(sid) = &sid {
                rb = rb.header("X-OS-SID", sid);
            }
            match rb.send().await {
                Ok(resp) if resp.status().is_success() => {
                    let body: serde_json::Value = resp.json().await.unwrap_or_default();
                    let tickets: Vec<TicketSummary> = body["data"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                                .collect()
                        })
                        .unwrap_or_default();
                    req.reply(Message::TicketList(TicketListPayload { tickets }))
                }
                Ok(resp) => req.reply(Message::Error(ErrorPayload {
                    code: "tickets_error".into(),
                    message: format!("Server returned {}", resp.status()),
                })),
                Err(e) => req.reply(Message::Error(ErrorPayload {
                    code: "tickets_error".into(),
                    message: format!("Request failed: {}", e),
                })),
            }
        }

        Message::AddTicketNote(payload) => {
            let device_id = match &s.device_id {
                Some(id) => id.clone(),
                None => return req.reply(Message::Error(ErrorPayload {
                    code: "not_enrolled".into(),
                    message: "Device is not enrolled".into(),
                })),
            };
            drop(s);
            let url = format!("{}/v2.0/tickets/{}/reply", cfg.agent.server_url, payload.ticket_id);
            let client = reqwest::Client::new();
            match client
                .post(&url)
                .header("X-Device-ID", &device_id)
                .header("X-Org-ID", &cfg.agent.org_id)
                .json(payload)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    req.reply(Message::TicketNoteAck(TicketNoteAckPayload {
                        accepted: true,
                        message: "Note added".into(),
                    }))
                }
                Ok(resp) => req.reply(Message::Error(ErrorPayload {
                    code: "note_error".into(),
                    message: format!("Server returned {}", resp.status()),
                })),
                Err(e) => req.reply(Message::Error(ErrorPayload {
                    code: "note_error".into(),
                    message: format!("Request failed: {}", e),
                })),
            }
        }

        Message::GetTicketDetail(payload) => {
            let ticket_id = payload.ticket_id.clone();
            let device_id = match &s.device_id {
                Some(id) => id.clone(),
                None => return req.reply(Message::Error(ErrorPayload {
                    code: "not_enrolled".into(),
                    message: "Device is not enrolled".into(),
                })),
            };
            drop(s);
            let url = format!("{}/v2.0/tickets/{}", cfg.agent.server_url, ticket_id);
            let client = reqwest::Client::new();
            match client
                .get(&url)
                .header("X-Device-ID", &device_id)
                .header("X-Org-ID", &cfg.agent.org_id)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    let body: serde_json::Value = resp.json().await.unwrap_or_default();
                    let data = &body["data"];
                    let returned_ticket_id = data["ticket_id"]
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| ticket_id.clone());
                    let actions: Vec<TicketActionSummary> = data["actions"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                                .collect()
                        })
                        .unwrap_or_default();
                    req.reply(Message::TicketDetail(TicketDetailPayload {
                        ticket_id: returned_ticket_id,
                        actions,
                    }))
                }
                Ok(resp) => req.reply(Message::Error(ErrorPayload {
                    code: "ticket_detail_error".into(),
                    message: format!("Server returned {}", resp.status()),
                })),
                Err(e) => req.reply(Message::Error(ErrorPayload {
                    code: "ticket_detail_error".into(),
                    message: format!("Request failed: {}", e),
                })),
            }
        }

        Message::GetPendingEvents => {
            drop(s);
            let drained: Vec<_> = {
                let mut q = events.lock().await;
                q.drain(..).collect()
            };
            req.reply(Message::PendingEvents(PendingEventsPayload { events: drained }))
        }

        _ => req.reply(Message::Error(ErrorPayload {
            code: "unexpected_message".into(),
            message: "agent-core received unexpected message kind".into(),
        })),
    }
}
