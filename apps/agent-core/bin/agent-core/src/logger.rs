use chrono::Utc;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024; // 5 MB — rotate if exceeded at startup
const KEEP_ROTATED: u32 = 5;                 // agent-core.log.1 … agent-core.log.5

fn logs_dir(root: &Path) -> PathBuf {
    root.join("logs")
}

/// Shift logs/agent-core.log → .log.1 → .log.2 … dropping anything beyond KEEP_ROTATED.
fn rotate(logs: &Path) {
    let _ = std::fs::remove_file(logs.join(format!("agent-core.log.{}", KEEP_ROTATED)));
    for i in (1..KEEP_ROTATED).rev() {
        let from = logs.join(format!("agent-core.log.{}", i));
        let to   = logs.join(format!("agent-core.log.{}", i + 1));
        let _ = std::fs::rename(from, to);
    }
    let _ = std::fs::rename(logs.join("agent-core.log"), logs.join("agent-core.log.1"));
}

/// Initialise the runtime logger. Pass `force_rotate = true` on a version change;
/// the log is also rotated automatically when it exceeds MAX_LOG_BYTES.
pub fn init(root: &Path, force_rotate: bool) {
    let logs = logs_dir(root);
    let _ = std::fs::create_dir_all(&logs);

    let base = logs.join("agent-core.log");
    let over_size = std::fs::metadata(&base)
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false);

    if force_rotate || over_size {
        rotate(&logs);
    }

    let _ = LOG_PATH.set(base);
}

pub fn log(level: &str, msg: &str) {
    let ts = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let line = format!("[{}] {} {}\n", ts, level, msg);
    eprint!("{}", line);
    if let Some(path) = LOG_PATH.get() {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

/// Append a single line to logs/install.log (separate from the runtime log).
pub fn install_log(root: &Path, msg: &str) {
    let logs = logs_dir(root);
    let _ = std::fs::create_dir_all(&logs);
    let ts = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let line = format!("[{}] {}\n", ts, msg);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(logs.join("install.log")) {
        let _ = f.write_all(line.as_bytes());
    }
}

macro_rules! info {
    ($($arg:tt)*) => { $crate::logger::log("INFO ", &format!($($arg)*)) };
}

macro_rules! logwarn {
    ($($arg:tt)*) => { $crate::logger::log("WARN ", &format!($($arg)*)) };
}

macro_rules! logerr {
    ($($arg:tt)*) => { $crate::logger::log("ERROR", &format!($($arg)*)) };
}

pub(crate) use {info, logerr, logwarn};
