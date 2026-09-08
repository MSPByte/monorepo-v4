use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub agent: AgentSection,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AgentSection {
    pub server_url: String,
    pub org_id: String,
    pub enrollment_token: String,
}

pub fn load(root: &Path) -> anyhow::Result<Config> {
    let path = root.join("config.toml");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("Cannot read {}: {}", path.display(), e))?;
    toml::from_str(&text).map_err(|e| anyhow::anyhow!("Invalid config.toml: {}", e))
}
