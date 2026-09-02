use serde::{Deserialize, Serialize};

/// Every IPC message is wrapped in an Envelope so responses can be correlated
/// to their originating requests by matching the `id` field.
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

/// All messages that can flow over the IPC socket. Both directions use this
/// same enum. The `kind` field is the discriminator; unit variants omit
/// `payload` entirely.
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

    // Ticket submission (Phase 4 adds real forms; this is the wire contract now)
    SubmitForm(SubmitFormPayload),
    SubmitFormAck(SubmitFormAckPayload),

    // OS user — collected by the UI process since core runs as SYSTEM/root
    GetOsUser,
    OsUser(OsUserPayload),

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
    /// The full bundle JSON from the server, or None if never fetched.
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
pub struct OsUserPayload {
    pub username: String,
    /// Windows SID, None on macOS/Linux.
    pub sid: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}
