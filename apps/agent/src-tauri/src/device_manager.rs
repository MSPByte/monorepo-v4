use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use whoami;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub site_id: String,
    pub device_id: Option<String>,
    pub guid: Option<String>,
    pub api_host: String,
    pub hostname: Option<String>,
    pub installed_at: String,
    pub registered_at: Option<String>,
    pub show_tray: Option<bool>,
}

pub fn get_config_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from("C:\\ProgramData\\MSPAgent")
    }
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/Library/Application Support/MSPAgent")
    }
    #[cfg(target_os = "linux")]
    {
        PathBuf::from("/etc/mspagent")
    }
}

pub fn get_settings_path() -> PathBuf {
    get_config_dir().join("settings.json")
}

pub async fn get_settings() -> Result<Settings, Box<dyn std::error::Error>> {
    let settings_path = get_settings_path();

    if !settings_path.exists() {
        return Err("No settings found. Please reinstall the application.".into());
    }

    let content = tokio::fs::read_to_string(&settings_path).await?;
    let content = content.trim_start_matches('\u{FEFF}');
    let settings: Settings = serde_json::from_str(&content)?;

    Ok(settings)
}

pub fn get_primary_mac() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = Command::new("getmac")
            .args(&["/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        if let Some(first_line) = output_str.lines().next() {
            if let Some(mac) = first_line.split(',').next() {
                return Some(mac.trim_matches('"').to_string());
            }
        }
        None
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("ifconfig").arg("en0").output().ok()?;
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            if line.contains("ether") {
                if let Some(mac) = line.split_whitespace().nth(1) {
                    return Some(mac.to_string());
                }
            }
        }
        None
    }

    #[cfg(target_os = "linux")]
    {
        let net_dir = std::path::Path::new("/sys/class/net");
        if let Ok(entries) = std::fs::read_dir(net_dir) {
            for entry in entries.flatten() {
                let interface = entry.file_name();
                let interface_str = interface.to_string_lossy();
                if interface_str.starts_with("lo") {
                    continue;
                }
                let mac_path = net_dir.join(&interface).join("address");
                if let Ok(mac) = std::fs::read_to_string(&mac_path) {
                    let trimmed = mac.trim();
                    if !trimmed.is_empty() && trimmed != "00:00:00:00:00:00" {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
        None
    }
}

pub fn get_rmm_device_id() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::fs;
        use winreg::{enums::*, RegKey};

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        if let Ok(subkey) = hklm.open_subkey("SOFTWARE\\CentraStage") {
            if let Ok(device_id) = subkey.get_value::<String, _>("DeviceID") {
                let trimmed = device_id.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }

        const SETTINGS_PATH: &str = r"C:\ProgramData\CentraStage\AEMAgent\Settings.json";
        if let Ok(contents) = fs::read_to_string(SETTINGS_PATH) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) {
                if let Some(device_uid) = json["deviceUID"].as_str() {
                    let trimmed = device_uid.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }

        None
    }

    #[cfg(target_os = "macos")]
    {
        use std::fs;
        let settings_path = "/usr/local/share/CentraStage/AEMAgent/Settings.json";
        match fs::read_to_string(settings_path) {
            Ok(contents) => match serde_json::from_str::<serde_json::Value>(&contents) {
                Ok(json) => json
                    .get("deviceUID")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                Err(_) => None,
            },
            Err(_) => None,
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

pub async fn get_username() -> Option<String> {
    Some(whoami::username())
}
