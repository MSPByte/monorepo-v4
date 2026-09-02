use chrono::Utc;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn init(root: &std::path::Path) {
    let _ = LOG_PATH.set(root.join("agent-core.log"));
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

macro_rules! info {
    ($($arg:tt)*) => { $crate::logger::log("INFO ", &format!($($arg)*)) };
}

macro_rules! logwarn {
    ($($arg:tt)*) => { $crate::logger::log("WARN ", &format!($($arg)*)) };
}

macro_rules! logerr {
    ($($arg:tt)*) => { $crate::logger::log("ERROR", &format!($($arg)*)) };
}

pub(crate) use {info, logwarn, logerr};
