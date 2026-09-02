use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct State {
    pub device_id: Option<String>,
    pub bundle_etag: Option<String>,
    pub bundle_fetched_at: Option<DateTime<Utc>>,
}

pub fn load(root: &Path) -> State {
    let path = root.join("state.json");
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Atomic write: write to a temp file then rename.
pub fn save(root: &Path, state: &State) -> anyhow::Result<()> {
    let path = root.join("state.json");
    let tmp = root.join("state.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(state)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
