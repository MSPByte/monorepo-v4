use std::path::PathBuf;

/// In dev mode (MSPAGENT_DEV=1): skip privilege check, use a user-writable root.
fn is_dev() -> bool {
    std::env::var("MSPAGENT_DEV").as_deref() == Ok("1")
}

fn dev_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"C:\Temp"));

    #[cfg(not(target_os = "windows"))]
    let base = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"));

    base.join(".mspagent-dev")
}

/// Root data directory for agent-core (privileged files: config, state, bundle).
pub fn root_path() -> PathBuf {
    if is_dev() {
        return dev_root();
    }

    #[cfg(target_os = "windows")]
    return PathBuf::from(r"C:\ProgramData\MSPAgent");

    #[cfg(target_os = "macos")]
    return PathBuf::from("/Library/Application Support/MSPAgent");

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return PathBuf::from("/etc/mspagent");
}

/// Path to the IPC socket (Unix) or named pipe (Windows).
pub fn socket_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let pipe = if is_dev() { r"\\.\pipe\MSPAgentDev" } else { r"\\.\pipe\MSPAgent" };
        return PathBuf::from(pipe);
    }

    #[cfg(not(target_os = "windows"))]
    root_path().join("agent.sock")
}

/// Returns `true` when the process is running with elevated / system privileges.
/// Always returns `true` in dev mode so agent-core can run as a normal user.
pub fn is_privileged() -> bool {
    if is_dev() {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token = 0isize;
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }
            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut ret_len: u32 = 0;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                &mut elevation as *mut _ as *mut _,
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            );
            ok != 0 && elevation.TokenIsElevated != 0
        }
    }

    #[cfg(unix)]
    {
        // SAFETY: geteuid() is always safe to call.
        unsafe { libc::geteuid() == 0 }
    }

    #[cfg(not(any(target_os = "windows", unix)))]
    false
}
