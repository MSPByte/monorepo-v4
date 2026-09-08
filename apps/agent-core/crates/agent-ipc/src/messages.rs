use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub id: u64,
    #[serde(flatten)]
    pub message: Message,
}

impl Envelope {
    pub fn reply(&self, message: Message) -> Envelope {
        Envelope { id: self.id, message }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
pub enum Message {
    // Lifecycle
    Ping,
    Pong,

    // Status
    GetStatus,
    Status(StatusPayload),

    // Config bundle — server-fetched branding/forms config
    GetConfigBundle,
    ConfigBundle(ConfigBundlePayload),

    // Ticket submission
    SubmitForm(SubmitFormPayload),
    SubmitFormAck(SubmitFormAckPayload),

    // Ticket listing — optionally filtered by OS user SID for per-user scoping
    GetTickets(GetTicketsPayload),
    TicketList(TicketListPayload),

    // Add a note / reply to an existing ticket
    AddTicketNote(AddTicketNotePayload),
    TicketNoteAck(TicketNoteAckPayload),

    // Ticket detail — full action thread for a single ticket
    GetTicketDetail(GetTicketDetailPayload),
    TicketDetail(TicketDetailPayload),

    // OS user info
    GetOsUser,
    OsUser(OsUserPayload),

    // Pending push events — drain the in-process queue from WS pushes
    GetPendingEvents,
    PendingEvents(PendingEventsPayload),

    // Generic error response
    Error(ErrorPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusPayload {
    pub enrolled: bool,
    pub version: String,
    pub device_id: Option<String>,
    pub last_checkin_at: Option<String>,
    pub bundle_etag: Option<String>,
    pub bundle_offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigBundlePayload {
    pub etag: Option<String>,
    pub fetched_at: Option<String>,
    pub offline: bool,
    pub bundle: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitFormPayload {
    pub form_id: String,
    pub form_version_id: String,
    pub answers: serde_json::Value,
    pub os_user: OsUserPayload,
    pub attachments: Vec<AttachmentPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentPayload {
    pub field_id: String,
    pub name: String,
    pub mime_type: String,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitFormAckPayload {
    pub accepted: bool,
    pub message: String,
    pub submission_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetTicketsPayload {
    /// When set, only tickets whose os_user_sid matches are returned.
    /// Implements per-user scoping on shared machines (decision #7).
    pub os_user_sid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketSummary {
    pub id: String,         // agent.tickets.id (internal UUID)
    pub ticket_id: String,  // PSA ticket ID
    pub summary: String,
    pub created_at: String,
    #[serde(default)]
    pub status_id: Option<i64>,
    #[serde(default)]
    pub status_name: Option<String>,
    #[serde(default)]
    pub is_open: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketListPayload {
    pub tickets: Vec<TicketSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteAttachmentPayload {
    pub name: String,
    pub mime_type: String,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTicketNotePayload {
    pub ticket_id: String,  // PSA ticket ID
    pub note: String,
    pub os_user: OsUserPayload,
    pub attachments: Vec<NoteAttachmentPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetTicketDetailPayload {
    pub ticket_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketActionSummary {
    pub id: String,
    pub note_html: String,
    pub note: String,
    pub who: String,
    pub is_agent: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketDetailPayload {
    pub ticket_id: String,
    pub actions: Vec<TicketActionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketNoteAckPayload {
    pub accepted: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsUserPayload {
    pub username: String,
    pub sid: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingEventEntry {
    BundleUpdated { etag: Option<String> },
    TicketNoteAdded { ticket_id: String },
    TicketStatusChanged { ticket_id: String, status_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEventsPayload {
    pub events: Vec<PendingEventEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}
