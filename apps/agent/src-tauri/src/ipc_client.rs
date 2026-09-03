use agent_ipc::{
    AddTicketNotePayload, ConfigBundlePayload, Envelope, GetTicketsPayload, Message, OsUserPayload,
    StatusPayload, SubmitFormAckPayload, SubmitFormPayload, TicketListPayload, TicketNoteAckPayload,
};
use agent_platform::socket_path;

static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

async fn call(msg: Message) -> Result<Message, String> {
    let req = Envelope { id: next_id(), message: msg };
    let resp = agent_ipc::request(&socket_path(), &req)
        .await
        .map_err(|e| format!("IPC error: {}", e))?;
    Ok(resp.message)
}

pub async fn get_status() -> Result<StatusPayload, String> {
    match call(Message::GetStatus).await? {
        Message::Status(p) => Ok(p),
        Message::Error(e) => Err(e.message),
        _ => Err("unexpected IPC response".into()),
    }
}

pub async fn is_enrolled() -> bool {
    get_status().await.map(|s| s.enrolled).unwrap_or(false)
}

pub async fn get_config_bundle() -> Result<ConfigBundlePayload, String> {
    match call(Message::GetConfigBundle).await? {
        Message::ConfigBundle(p) => Ok(p),
        Message::Error(e) => Err(e.message),
        _ => Err("unexpected IPC response".into()),
    }
}

pub async fn get_os_user() -> Result<OsUserPayload, String> {
    match call(Message::GetOsUser).await? {
        Message::OsUser(p) => Ok(p),
        Message::Error(e) => Err(e.message),
        _ => Err("unexpected IPC response".into()),
    }
}

pub async fn submit_form(payload: SubmitFormPayload) -> Result<SubmitFormAckPayload, String> {
    match call(Message::SubmitForm(payload)).await? {
        Message::SubmitFormAck(p) => Ok(p),
        Message::Error(e) => Err(e.message),
        _ => Err("unexpected IPC response".into()),
    }
}

pub async fn get_tickets(os_user_sid: Option<String>) -> Result<TicketListPayload, String> {
    match call(Message::GetTickets(GetTicketsPayload { os_user_sid })).await? {
        Message::TicketList(p) => Ok(p),
        Message::Error(e) => Err(e.message),
        _ => Err("unexpected IPC response".into()),
    }
}

pub async fn add_ticket_note(
    ticket_id: String,
    note: String,
    os_user: OsUserPayload,
) -> Result<TicketNoteAckPayload, String> {
    match call(Message::AddTicketNote(AddTicketNotePayload { ticket_id, note, os_user })).await? {
        Message::TicketNoteAck(p) => Ok(p),
        Message::Error(e) => Err(e.message),
        _ => Err("unexpected IPC response".into()),
    }
}
