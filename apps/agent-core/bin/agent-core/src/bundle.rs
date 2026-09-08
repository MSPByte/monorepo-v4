use anyhow::Context;
use serde_json::Value;
use std::path::Path;

use crate::{
    config::Config,
    logger::{info, logwarn},
    state::State,
};

const BUNDLE_FILE: &str = "bundle.json";

/// Load the cached bundle JSON from disk. Returns None if no bundle is cached yet.
pub fn load_cached(root: &Path) -> Option<Value> {
    let path = root.join(BUNDLE_FILE);
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Fetch the bundle from the server. If unchanged (304), returns Ok(false).
/// If updated, saves bundle.json and updates state etag/fetched_at, returns Ok(true).
pub async fn fetch(cfg: &Config, root: &Path, state: &mut State) -> anyhow::Result<bool> {
    let device_id = match &state.device_id {
        Some(id) => id.clone(),
        None => return Ok(false), // not enrolled yet
    };

    let client = reqwest::Client::new();
    let mut req = client
        .get(format!("{}/v2.0/bundle", cfg.agent.server_url))
        .header("X-Device-ID", &device_id)
        .header("X-Org-ID", &cfg.agent.org_id);

    if let Some(etag) = &state.bundle_etag {
        req = req.header("If-None-Match", etag);
    }

    let resp = req.send().await.context("bundle fetch request failed")?;

    match resp.status().as_u16() {
        304 => {
            info!("Bundle unchanged (304)");
            Ok(false)
        }
        204 => {
            info!("No bundle configured for this site");
            Ok(false)
        }
        200 => {
            let etag = resp
                .headers()
                .get("etag")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let body: serde_json::Value = resp.json().await.context("parse bundle response")?;
            let bundle = body.get("data").cloned().unwrap_or(body);

            // Atomic write: temp file then rename.
            let tmp = root.join("bundle.json.tmp");
            std::fs::write(&tmp, serde_json::to_string(&bundle)?)?;
            std::fs::rename(&tmp, root.join(BUNDLE_FILE))?;

            state.bundle_etag = etag;
            state.bundle_fetched_at = Some(chrono::Utc::now());

            info!("Bundle updated");
            Ok(true)
        }
        status => {
            logwarn!("Bundle fetch returned unexpected status {}", status);
            Ok(false)
        }
    }
}
