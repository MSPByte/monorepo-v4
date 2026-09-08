use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::RwLock;

use crate::{
    config::Config,
    logger::{info, logwarn, logerr},
    state::{save, State},
};

#[derive(Debug, Serialize)]
struct EnrollBody {
    org_id: String,
    enrollment_token: String,
    hostname: String,
    platform: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    machine_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EnrollResponse {
    data: EnrollData,
}

#[derive(Debug, Deserialize)]
struct EnrollData {
    device_id: String,
}

#[derive(Debug, Serialize)]
struct CheckinBody {
    hostname: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
}

async fn enroll(cfg: &Config) -> anyhow::Result<String> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".into());
    let platform = std::env::consts::OS.to_string();
    let username = Some(whoami::username());

    let body = EnrollBody {
        org_id: cfg.agent.org_id.clone(),
        enrollment_token: cfg.agent.enrollment_token.clone(),
        hostname,
        platform,
        version: env!("CARGO_PKG_VERSION").to_string(),
        machine_id: machine_id(),
        username,
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v2.0/enroll", cfg.agent.server_url))
        .json(&body)
        .send()
        .await
        .context("enroll request failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("enroll returned {}: {}", status, text);
    }

    let parsed: EnrollResponse = resp.json().await.context("parse enroll response")?;
    Ok(parsed.data.device_id)
}

async fn checkin(cfg: &Config, device_id: &str) -> anyhow::Result<()> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".into());

    let body = CheckinBody {
        hostname,
        version: env!("CARGO_PKG_VERSION").to_string(),
        username: Some(whoami::username()),
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v2.0/checkin", cfg.agent.server_url))
        .header("X-Device-ID", device_id)
        .header("X-Org-ID", &cfg.agent.org_id)
        .json(&body)
        .send()
        .await
        .context("checkin request failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        anyhow::bail!("checkin returned {}", status);
    }
    Ok(())
}

/// Returns a best-effort machine identifier (stable across reinstalls).
fn machine_id() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/machine-id")
            .ok()
            .map(|s| s.trim().to_string())
    }

    #[cfg(target_os = "macos")]
    {
        // Use the platform UUID from ioreg
        let out = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if line.contains("IOPlatformUUID") {
                if let Some(uuid) = line.split('"').nth(3) {
                    return Some(uuid.to_string());
                }
            }
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        // MachineGuid from registry
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        hklm.open_subkey(r"SOFTWARE\Microsoft\Cryptography")
            .and_then(|k| k.get_value::<String, _>("MachineGuid"))
            .ok()
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    None
}

/// Background task: enroll if needed, then check in every `interval`.
pub async fn run_checkin_loop(
    cfg: Config,
    root: PathBuf,
    state: Arc<RwLock<State>>,
    interval: Duration,
) {
    // Enrollment backoff: 5s, 10s, 30s, then 60s for all subsequent retries.
    const ENROLL_BACKOFF: &[u64] = &[5, 10, 30];
    let mut enroll_attempt: usize = 0;

    loop {
        // Ensure we have a device_id.
        let device_id = {
            let s = state.read().await;
            s.device_id.clone()
        };

        let device_id = match device_id {
            Some(id) => {
                enroll_attempt = 0; // reset on success
                id
            }
            None => {
                info!("No device_id; enrolling... (attempt {})", enroll_attempt + 1);
                match enroll(&cfg).await {
                    Ok(id) => {
                        info!("Enrolled as {}", id);
                        enroll_attempt = 0;
                        let mut s = state.write().await;
                        s.device_id = Some(id.clone());
                        if let Err(e) = save(&root, &s) {
                            logerr!("Failed to save state: {}", e);
                        }
                        id
                    }
                    Err(e) => {
                        // {:#} walks the full anyhow error chain so the root cause is visible.
                        logerr!("Enrollment failed: {:#}", e);
                        let wait = ENROLL_BACKOFF
                            .get(enroll_attempt)
                            .copied()
                            .unwrap_or(60);
                        enroll_attempt = enroll_attempt.saturating_add(1);
                        info!("Retrying enrollment in {}s", wait);
                        tokio::time::sleep(Duration::from_secs(wait)).await;
                        continue;
                    }
                }
            }
        };

        match checkin(&cfg, &device_id).await {
            Ok(()) => {
                info!("Checkin OK");
            }
            Err(e) => {
                logwarn!("Checkin failed: {:#}", e);
            }
        }

        // Fetch bundle after each checkin. The state write happens inside fetch().
        {
            let mut s = state.write().await;
            match crate::bundle::fetch(&cfg, &root, &mut s).await {
                Ok(_) => {
                    let _ = save(&root, &s);
                }
                Err(e) => {
                    logwarn!("Bundle fetch failed: {:#}", e);
                }
            }
        }

        // Check for a newer agent-core binary. If one is staged, the next
        // service restart will apply it automatically.
        {
            let mut s = state.write().await;
            match crate::update::check_and_stage(&cfg, &root, &mut s).await {
                Ok(true) => {
                    let _ = save(&root, &s);
                }
                Ok(false) => {}
                Err(e) => {
                    logwarn!("Update check failed: {}", e);
                }
            }
        }

        tokio::time::sleep(interval).await;
    }
}
