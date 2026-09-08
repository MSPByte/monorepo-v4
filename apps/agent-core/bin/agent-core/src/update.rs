use anyhow::{anyhow, Context, Result};
use std::path::Path;

use crate::{config::Config, logger::info, state::State};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Checks for a newer agent-core binary and downloads it into `<root>/pending/`.
/// Returns `true` if a download was staged; the caller (checkin loop) should
/// schedule a restart after the next idle window.
pub async fn check_and_stage(cfg: &Config, root: &Path, state: &mut State) -> Result<bool> {
    let device_id = match &state.device_id {
        Some(id) => id.clone(),
        None => return Ok(false),
    };

    let platform = platform_slug();
    let url = format!("{}/v2.0/updates", cfg.agent.server_url);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("X-Device-ID", &device_id)
        .header("X-Org-ID", &cfg.agent.org_id)
        .send()
        .await
        .context("update check request failed")?;

    if !resp.status().is_success() {
        return Ok(false);
    }

    let body: serde_json::Value = resp.json().await.context("update check response parse")?;
    let latest = body["data"]["latest_version"]
        .as_str()
        .ok_or_else(|| anyhow!("missing latest_version"))?
        .to_string();

    if !is_newer(&latest, CURRENT_VERSION) {
        return Ok(false);
    }

    let download_url = body["data"]["platforms"][&platform]
        .as_str()
        .ok_or_else(|| anyhow!("no download URL for platform {}", platform))?
        .to_string();

    info!("Update available: {} → {}. Downloading from {}", CURRENT_VERSION, latest, download_url);

    let pending_dir = root.join("pending");
    std::fs::create_dir_all(&pending_dir).context("create pending dir")?;

    #[cfg(target_os = "windows")]
    let binary_name = "agent-core.new.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "agent-core.new";

    let dest = pending_dir.join(binary_name);

    let bin_resp = client
        .get(&download_url)
        .header("X-Device-ID", &device_id)
        .send()
        .await
        .context("binary download failed")?;

    let bytes = bin_resp.bytes().await.context("binary read failed")?;
    std::fs::write(&dest, &bytes).context("write pending binary")?;

    // Mark as executable on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))
            .context("chmod pending binary")?;
    }

    // Write a marker file with the staged version so apply_pending can log it.
    std::fs::write(root.join("update.ready"), &latest).context("write update.ready")?;

    info!("Staged update {} to {}. Will apply on next restart.", latest, dest.display());
    state.pending_update_version = Some(latest);
    Ok(true)
}

/// Called at startup before anything else. If a staged binary exists, swap it
/// over the running binary and exec self to restart cleanly.
pub fn apply_pending(root: &Path) {
    let ready_path = root.join("update.ready");
    if !ready_path.exists() {
        return;
    }

    let version = std::fs::read_to_string(&ready_path).unwrap_or_default();
    let version = version.trim();

    #[cfg(target_os = "windows")]
    let binary_name = "agent-core.new.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "agent-core.new";

    let staged = root.join("pending").join(binary_name);
    if !staged.exists() {
        // Stale marker — remove it.
        let _ = std::fs::remove_file(&ready_path);
        return;
    }

    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("update: cannot determine current exe: {}", e);
            return;
        }
    };

    // On Windows we can't overwrite a running .exe, so we rename ours first.
    #[cfg(target_os = "windows")]
    {
        let old_path = current_exe.with_extension("old.exe");
        if let Err(e) = std::fs::rename(&current_exe, &old_path) {
            eprintln!("update: cannot rename current exe: {}", e);
            return;
        }
        if let Err(e) = std::fs::rename(&staged, &current_exe) {
            eprintln!("update: cannot move staged binary: {}", e);
            // Try to restore
            let _ = std::fs::rename(&old_path, &current_exe);
            return;
        }
        // Cleanup old binary (best effort; may fail if still locked — a later run will clean it).
        let _ = std::fs::remove_file(&old_path);
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Err(e) = std::fs::rename(&staged, &current_exe) {
            eprintln!("update: cannot move staged binary: {}", e);
            return;
        }
    }

    let _ = std::fs::remove_file(&ready_path);
    eprintln!("update: applied version {}; restarting…", version);

    // exec self — replaces the process image without changing the PID,
    // so the service manager keeps tracking us.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let args: Vec<_> = std::env::args().collect();
        let err = std::process::Command::new(&current_exe).args(&args[1..]).exec();
        eprintln!("update: exec failed: {}", err);
        std::process::exit(1);
    }

    // On Windows, service manager will restart us after exit because the
    // SCM failure action is set to "restart service".
    #[cfg(windows)]
    {
        std::process::exit(0);
    }
}

/// Returns `true` if `candidate` is a strictly higher semver than `current`.
/// Falls back to a simple string comparison if parsing fails.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_semver(candidate), parse_semver(current)) {
        (Some(c), Some(cur)) => c > cur,
        _ => candidate != current,
    }
}

fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let s = s.trim_start_matches('v');
    let mut parts = s.splitn(3, '.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next()?.split('-').next()?.parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn platform_slug() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "windows-x86_64";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "linux-x86_64";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "linux-aarch64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "darwin-x86_64";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "darwin-aarch64";
    #[allow(unreachable_code)]
    "unknown"
}
