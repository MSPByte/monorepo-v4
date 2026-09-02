use agent_ipc::{Envelope, Message, StatusPayload};
use agent_platform::socket_path;

static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Returns the agent-core status. Returns an error string if the core is not reachable.
pub async fn get_status() -> Result<StatusPayload, String> {
    let req = Envelope {
        id: next_id(),
        message: Message::GetStatus,
    };
    let resp = agent_ipc::request(&socket_path(), &req)
        .await
        .map_err(|e| format!("IPC error: {}", e))?;
    match resp.message {
        Message::Status(payload) => Ok(payload),
        Message::Error(e) => Err(format!("agent-core error: {}", e.message)),
        _ => Err("unexpected IPC response".into()),
    }
}

/// Returns true if agent-core is reachable and the device is enrolled.
pub async fn is_enrolled() -> bool {
    get_status().await.map(|s| s.enrolled).unwrap_or(false)
}
