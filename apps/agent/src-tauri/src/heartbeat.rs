use crate::device_manager::{get_primary_mac, get_settings, get_username};
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct HeartbeatRequest {
    pub hostname: String,
    pub ip_address: Option<String>,
    pub ext_address: Option<String>,
    pub version: String,
    pub mac_address: Option<String>,
    pub guid: Option<String>,
    pub username: Option<String>,
}

pub async fn gather_system_info() -> Result<HeartbeatRequest, Box<dyn std::error::Error>> {
    let settings = get_settings().await?;
    let hostname = settings
        .hostname
        .clone()
        .unwrap_or_else(|| hostname::get().unwrap().to_string_lossy().to_string());
    let mac_address = get_primary_mac();
    let ip_address = get_local_ip();
    let ext_address = get_external_ip().await.ok();
    let username = get_username().await;

    Ok(HeartbeatRequest {
        hostname,
        ip_address,
        ext_address,
        version: env!("CARGO_PKG_VERSION").to_string(),
        mac_address,
        guid: settings.guid,
        username,
    })
}

pub fn get_local_ip() -> Option<String> {
    use local_ip_address::local_ip;
    match local_ip() {
        Ok(ip) => Some(ip.to_string()),
        Err(_) => None,
    }
}

pub async fn get_external_ip() -> Result<String, Box<dyn std::error::Error>> {
    use tokio::time::Duration;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;
    let response = client
        .get("https://api.ipify.org?format=text")
        .send()
        .await?;
    Ok(response.text().await?)
}
