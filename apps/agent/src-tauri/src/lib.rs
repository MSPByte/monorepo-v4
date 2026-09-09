mod device_manager;
mod heartbeat;
mod ipc_client;
mod logger;

use base64::engine::general_purpose;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::{
    AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder,
    tray::TrayIconBuilder,
    menu::{Menu, MenuItem}
};
use tauri_plugin_screenshots::{get_monitor_screenshot, get_screenshotable_monitors};

use device_manager::{get_settings, get_rmm_device_id};
use heartbeat::gather_system_info;
use heartbeat::HeartbeatRequest;
use logger::log_to_file;

#[derive(Clone)]
struct TrayActions(Arc<Mutex<Vec<String>>>);

#[cfg(target_os = "windows")]
fn acquire_single_instance_lock() -> Option<windows_sys::Win32::Foundation::HANDLE> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    let username = whoami::username();
    let mutex_name: Vec<u16> = format!("Global\\MSPAgent_{}\0", username)
        .encode_utf16()
        .collect();

    unsafe {
        let handle = CreateMutexW(
            std::ptr::null(),
            0,
            mutex_name.as_ptr(),
        );

        if handle.is_null() || GetLastError() == ERROR_ALREADY_EXISTS {
            return None;
        }

        Some(handle)
    }
}

#[cfg(not(target_os = "windows"))]
fn acquire_single_instance_lock() -> Option<()> {
    Some(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _instance_lock = match acquire_single_instance_lock() {
        Some(lock) => lock,
        None => {
            log_to_file(
                "WARN".into(),
                "Another instance is already running for this user. Exiting.".into(),
            );
            return;
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_screenshots::init())
        .setup(|app| {
            // Create atomic flags for background task control
            // let heartbeat_running = Arc::new(AtomicBool::new(true));
            // let heartbeat_flag = heartbeat_running.clone();

            // Store the flags in app state for cleanup
            // app.manage(heartbeat_running);

            // Load the config bundle from agent-core and build the tray from it.
            // Falls back to a minimal tray if agent-core is unreachable at startup.
            let app_handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let bundle: Option<serde_json::Value> = ipc_client::get_config_bundle()
                    .await
                    .ok()
                    .and_then(|p| p.bundle);

                let show_tray = bundle
                    .as_ref()
                    .and_then(|b| b.get("tray"))
                    // `show` is the current bundle contract. Keep the former
                    // camelCase spelling readable for already-published bundles.
                    .and_then(|t| t.get("show").or_else(|| t.get("showTray")))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                if !show_tray {
                    log_to_file(String::from("INFO"), String::from("Tray disabled by bundle config"));
                    return;
                }

                let mut items: Vec<(String, String)> = bundle
                    .as_ref()
                    .and_then(|b| b.get("forms"))
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| {
                                let id = item.get("id")?.as_str()?;
                                let label = item.get("name")?.as_str()?.to_string();
                                Some((label, format!("open_form:{}", id)))
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                let show_my_tickets = bundle
                    .as_ref()
                    .and_then(|b| b.get("tray"))
                    .and_then(|t| t.get("showMyTickets"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if show_my_tickets {
                    items.push(("My Tickets".into(), "open_tickets".into()));
                }

                let tooltip = bundle
                    .as_ref()
                    .and_then(|b| b.get("tray"))
                    .and_then(|t| t.get("label"))
                    .and_then(|v| v.as_str())
                    .or_else(|| bundle.as_ref().and_then(|b| b.get("branding")).and_then(|b| b.get("appName")).and_then(|v| v.as_str()))
                    .unwrap_or("IT Support");
                let logo_url = bundle
                    .as_ref()
                    .and_then(|b| b.get("branding"))
                    .and_then(|b| b.get("logoUrl"))
                    .and_then(|v| v.as_str());

                if let Some(window) = app_handle.get_webview_window("support") {
                    let display_name = bundle
                        .as_ref()
                        .and_then(|b| b.get("branding"))
                        .and_then(|b| b.get("appName"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("IT Support");
                    let _ = window.set_title(display_name);
                }

                if let Err(e) = create_bundle_tray(&app_handle, items, tooltip, logo_url) {
                    log_to_file(String::from("ERROR"), format!("Failed to create tray: {}", e));
                }

                // agent-core atomically replaces its cached bundle. Poll its IPC view
                // so an already-running tray reflects the next successful fetch.
                let mut last_etag = ipc_client::get_config_bundle().await.ok().and_then(|p| p.etag);
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                    let Ok(payload) = ipc_client::get_config_bundle().await else { continue };
                    if payload.etag == last_etag { continue; }
                    last_etag = payload.etag;
                    if let Some(bundle) = payload.bundle {
                        if let Err(e) = refresh_bundle_tray(&app_handle, &bundle) {
                            log_to_file(String::from("ERROR"), format!("Failed to refresh tray: {}", e));
                        }
                    }
                }
            });

            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                app.set_activation_policy(ActivationPolicy::Accessory);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent the app from quitting when this window is closed
                api.prevent_close();
                let _ = window.hide();
                let _ = window.emit_to(EventTarget::Any, "on_hide", "");
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings_info,
            get_agent_status,
            get_config_bundle,
            get_os_user,
            submit_form,
            get_tickets,
            add_ticket_note,
            get_ticket_detail,
            hide_window,
            show_window,
            take_screenshot,
            read_file_text,
            read_file_base64,
            read_file_binary,
            read_registry_value,
            log_to_file,
            get_os_info,
            get_rmm_id,
            get_pending_events,
            get_entra_sso_status,
            start_entra_auth,
            get_cached_sso_token,
            clear_entra_auth
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Build the system tray from bundle-supplied items.
/// Each item is `(label, action)` where action is currently `"open_support"`.
fn create_bundle_tray(
    app: &AppHandle,
    items: Vec<(String, String)>,
    tooltip: &str,
    logo_url: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    log_to_file(String::from("INFO"), String::from("Creating bundle-driven tray icon"));

    let mut menu_items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();

    for (idx, (label, _action)) in items.iter().enumerate() {
        let id = format!("bundle_item_{}", idx);
        let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
        menu_items.push(Box::new(item));
    }

    // Always append a separator and About entry.
    let about_i = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
    menu_items.push(Box::new(about_i));

    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        menu_items.iter().map(|b| b.as_ref()).collect();

    let actions = items.into_iter().map(|(_, a)| a).collect::<Vec<_>>();
    app.manage(TrayActions(Arc::new(Mutex::new(actions))));
    let menu = Menu::with_items(app, refs.as_slice())?;

    let tray = TrayIconBuilder::new()
        .icon(tray_icon(app, logo_url))
        .tooltip(tooltip)
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id.as_ref();
            if id == "about" {
                handle_about_window(app);
                return;
            }
            // bundle_item_<idx>
            if let Some(rest) = id.strip_prefix("bundle_item_") {
                if let Ok(idx) = rest.parse::<usize>() {
                    let action = app
                        .state::<TrayActions>()
                        .0
                        .lock()
                        .ok()
                        .and_then(|actions| actions.get(idx).cloned())
                        .unwrap_or_default();
                    match action.as_str() {
                        "open_support" => handle_support_window(app, false, None),
                        "open_tickets" => {
                            handle_tickets_window(app);
                        }
                        _ if action.starts_with("open_form:") => {
                            let form_id = action.trim_start_matches("open_form:").to_string();
                            handle_support_window(app, false, Some(form_id));
                        }
                        _ => {}
                    }
                }
            }
        })
        .build(app)?;

    // Tauri removes a tray icon when its last `TrayIcon` handle is dropped.
    // Store it in managed application state for the lifetime of the app.
    app.manage(tray);

    log_to_file(String::from("INFO"), String::from("Bundle tray created successfully"));
    Ok(())
}

fn refresh_bundle_tray(app: &AppHandle, bundle: &serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
    let tray = app.state::<tauri::tray::TrayIcon<tauri::Wry>>();
    let show_tray = bundle.get("tray")
        .and_then(|t| t.get("show").or_else(|| t.get("showTray")))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    tray.set_visible(show_tray)?;
    if !show_tray { return Ok(()); }

    let mut items: Vec<(String, String)> = bundle.get("forms").and_then(|v| v.as_array())
        .map(|forms| forms.iter().filter_map(|form| {
            Some((form.get("name")?.as_str()?.to_string(), format!("open_form:{}", form.get("id")?.as_str()?)))
        }).collect())
        .unwrap_or_default();
    if bundle.get("tray").and_then(|t| t.get("showMyTickets")).and_then(|v| v.as_bool()).unwrap_or(true) {
        items.push(("My Tickets".into(), "open_tickets".into()));
    }
    let tooltip = bundle.get("tray").and_then(|t| t.get("label")).and_then(|v| v.as_str())
        .or_else(|| bundle.get("branding").and_then(|b| b.get("appName")).and_then(|v| v.as_str()))
        .unwrap_or("IT Support");
    let logo_url = bundle.get("branding").and_then(|b| b.get("logoUrl")).and_then(|v| v.as_str());

    let mut menu_items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();
    for (idx, (label, _)) in items.iter().enumerate() {
        menu_items.push(Box::new(MenuItem::with_id(app, format!("bundle_item_{}", idx), label, true, None::<&str>)?));
    }
    menu_items.push(Box::new(MenuItem::with_id(app, "about", "About", true, None::<&str>)?));
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = menu_items.iter().map(|item| item.as_ref()).collect();
    tray.set_menu(Some(Menu::with_items(app, refs.as_slice())?))?;
    *app.state::<TrayActions>().0.lock().map_err(|_| "tray actions lock poisoned")? = items.into_iter().map(|(_, action)| action).collect();
    tray.set_tooltip(Some(tooltip))?;
    tray.set_icon(Some(tray_icon(app, logo_url)))?;
    Ok(())
}

fn tray_icon(app: &AppHandle, logo_url: Option<&str>) -> tauri::image::Image<'static> {
    logo_url
        .and_then(|url| url.split_once(','))
        .and_then(|(_, encoded)| general_purpose::STANDARD.decode(encoded).ok())
        .and_then(|bytes| image::load_from_memory(&bytes).ok())
        .map(|image| {
            let rgba = image.to_rgba8();
            tauri::image::Image::new_owned(rgba.to_vec(), rgba.width(), rgba.height())
        })
        .unwrap_or_else(|| app.default_window_icon().expect("default tray icon").clone().to_owned())
}

fn handle_about_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("about") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        WebviewWindowBuilder::new(app, "about", WebviewUrl::App("about.html".into()))
            .title("About")
            .inner_size(300.0, 540.0)
            .build()
            .expect("Failed to create about window");
    }
}

fn handle_tickets_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("tickets") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        WebviewWindowBuilder::new(app, "tickets", WebviewUrl::App("tickets.html".into()))
            .title("My Tickets")
            .inner_size(1000.0, 800.0)
            .build()
            .expect("Failed to create My Tickets window");
    }
}

fn create_support_window(app: &AppHandle) {
    WebviewWindowBuilder::new(app, "support", WebviewUrl::App("support.html".into()))
        .title("Support Request")
        .inner_size(1000.0, 800.0)
        .build()
        .expect("Failed to create support window");
}

fn handle_support_window(app: &AppHandle, screenshot: bool, form_id: Option<String>) {
    let app_handle = app.clone();

    log_to_file(String::from("INFO"), format!("Opening support window with screenshot set to {}", screenshot));
    tauri::async_runtime::spawn(async move {
        let mut screenshot_path: Option<PathBuf> = None;

        // Step 1: Take screenshot first (if requested)
        if screenshot {
            if let Ok(path) = take_screenshot_internal(app_handle.clone()).await {
                screenshot_path = Some(path);
            }
        }

        // Step 2: Ensure window exists (create if needed). Track whether we just
        // created it so we can give React a moment to boot before emitting events.
        let freshly_created = app_handle.get_webview_window("support").is_none();
        let window = if !freshly_created {
            let window = app_handle.get_webview_window("support").unwrap();
            let _ = window.show();
            let _ = window.set_focus();
            window
        } else {
            create_support_window(&app_handle);
            app_handle
                .get_webview_window("support")
                .expect("support window should exist after creation")
        };

        // Step 3: If the window was freshly created, wait for React to mount and
        // register its event listeners before emitting form/screenshot events.
        if freshly_created {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        // Step 4: If a specific form was requested, tell the UI to open it.
        if let Some(id) = form_id {
            let _ = app_handle.emit("open_form", id);
        }

        // Step 5: If screenshot was taken, notify window
        if let Some(path) = screenshot_path {
            let _ = window.emit_to(EventTarget::Any, "use_screenshot", path);
        }
    });
}

async fn take_screenshot_internal(app: AppHandle) -> Result<PathBuf, String> {
    log_to_file(String::from("INFO"), String::from("Starting screenshot capture"));

    // Hide window if it exists
    if let Some(window) = app.get_webview_window("support") {
        log_to_file(String::from("INFO"), String::from("Hiding support window before screenshot"));
        let _ = window.hide();
        // Give time for window to hide
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    } else {
        log_to_file(String::from("INFO"), String::from("No support window to hide"));
    }

    // Get first available monitor
    log_to_file(String::from("INFO"), String::from("Getting screenshotable monitors"));
    let monitors = get_screenshotable_monitors().await
        .map_err(|e| {
            let err_msg = format!("Failed to get monitors: {}", e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })?;

    if monitors.is_empty() {
        let err_msg = String::from("No screenshotable monitors found");
        log_to_file(String::from("ERROR"), err_msg.clone());
        return Err(err_msg);
    }

    log_to_file(String::from("INFO"), format!("Found {} monitor(s), capturing from first monitor", monitors.len()));
    let path = get_monitor_screenshot(app, monitors[0].id).await
        .map_err(|e| {
            let err_msg = format!("Failed to capture screenshot: {}", e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })?;

    log_to_file(String::from("INFO"), format!("Screenshot saved to: {}", path.display()));
    Ok(path)
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    log_to_file(String::from("INFO"), format!("Hiding window: {}", label));
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|e| {
            let err_msg = format!("Failed to hide window {}: {}", label, e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })?;
        log_to_file(String::from("INFO"), format!("Successfully hidden window: {}", label));
    } else {
        log_to_file(String::from("WARN"), format!("Window not found: {}", label));
    }
    Ok(())
}

#[tauri::command]
fn show_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    log_to_file(String::from("INFO"), format!("Showing window: {}", label));
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|e| {
            let err_msg = format!("Failed to show window {}: {}", label, e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })?;
        window.set_focus().map_err(|e| {
            let err_msg = format!("Failed to focus window {}: {}", label, e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })?;
        log_to_file(String::from("INFO"), format!("Successfully shown window: {}", label));
    } else {
        log_to_file(String::from("INFO"), format!("Window {} not found, creating new window", label));
        create_support_window(&app);
        if let Some(window) = app.get_webview_window(&label) {
            window.show().map_err(|e| {
                let err_msg = format!("Failed to show newly created window {}: {}", label, e);
                log_to_file(String::from("ERROR"), err_msg.clone());
                err_msg
            })?;
            window.set_focus().map_err(|e| {
                let err_msg = format!("Failed to focus newly created window {}: {}", label, e);
                log_to_file(String::from("ERROR"), err_msg.clone());
                err_msg
            })?;
            log_to_file(String::from("INFO"), format!("Successfully created and shown window: {}", label));
        } else {
            let err_msg = format!("Failed to get window {} after creation", label);
            log_to_file(String::from("ERROR"), err_msg.clone());
            return Err(err_msg);
        }
    }
    Ok(())
}

#[tauri::command]
async fn take_screenshot(app: tauri::AppHandle) -> Result<String, String> {
    log_to_file(String::from("INFO"), String::from("take_screenshot command invoked"));
    let path = take_screenshot_internal(app).await?;
    let path_str = path.to_string_lossy().to_string();
    log_to_file(String::from("INFO"), format!("Returning screenshot path: {}", path_str));
    Ok(path_str)
}

#[tauri::command]
async fn get_settings_info() -> Result<device_manager::Settings, String> {
    log_to_file(String::from("INFO"), String::from("get_settings_info command invoked"));
    get_settings().await.map_err(|e| {
        let err_msg = format!("Failed to get settings: {}", e);
        log_to_file(String::from("ERROR"), err_msg.clone());
        err_msg
    })
}

#[tauri::command]
async fn get_agent_status() -> Result<agent_ipc::StatusPayload, String> {
    log_to_file(String::from("INFO"), String::from("get_agent_status command invoked"));
    ipc_client::get_status().await
}

#[tauri::command]
async fn get_config_bundle() -> Result<agent_ipc::ConfigBundlePayload, String> {
    ipc_client::get_config_bundle().await
}

#[tauri::command]
fn get_os_user() -> Result<agent_ipc::OsUserPayload, String> {
    let username = whoami::username();
    let sid = current_user_sid();
    Ok(agent_ipc::OsUserPayload { username, sid, display_name: None })
}

/// Returns a stable, unique-per-user identifier.
/// On Windows: the SID string (S-1-5-21-...).
/// On Unix: "uid:<effective-uid>" — not a SID but serves the same scoping purpose.
fn current_user_sid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER,
        };
        use windows_sys::Win32::System::Memory::LocalFree;
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        use std::ptr;

        unsafe {
            let mut token = 0isize;
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return None;
            }

            // First call: get required buffer size.
            let mut needed: u32 = 0;
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed);
            if needed == 0 {
                CloseHandle(token);
                return None;
            }

            let buf: Vec<u8> = vec![0u8; needed as usize];
            let ok = GetTokenInformation(
                token,
                TokenUser,
                buf.as_ptr() as *mut _,
                needed,
                &mut needed,
            );
            CloseHandle(token);
            if ok == 0 {
                return None;
            }

            let tu = &*(buf.as_ptr() as *const TOKEN_USER);
            let sid_ptr = tu.User.Sid;
            Some(sid_to_string(sid_ptr))
        }
    }

    #[cfg(unix)]
    {
        Some(format!("uid:{}", unsafe { libc::getuid() }))
    }

    #[cfg(not(any(target_os = "windows", unix)))]
    None
}

/// Formats a Windows SID pointer as the canonical S-1-... string.
#[cfg(target_os = "windows")]
unsafe fn sid_to_string(sid: *const std::ffi::c_void) -> String {
    let bytes = std::slice::from_raw_parts(sid as *const u8, 8);
    let revision = bytes[0];
    let sub_count = bytes[1] as usize;
    // Authority is 6 bytes big-endian starting at offset 2
    let authority: u64 = (bytes[2] as u64) << 40
        | (bytes[3] as u64) << 32
        | (bytes[4] as u64) << 24
        | (bytes[5] as u64) << 16
        | (bytes[6] as u64) << 8
        | (bytes[7] as u64);

    let sub_bytes = std::slice::from_raw_parts((sid as *const u8).add(8), sub_count * 4);
    let mut parts = format!("S-{}-{}", revision, authority);
    for i in 0..sub_count {
        let sub = u32::from_le_bytes([
            sub_bytes[i * 4],
            sub_bytes[i * 4 + 1],
            sub_bytes[i * 4 + 2],
            sub_bytes[i * 4 + 3],
        ]);
        parts.push('-');
        parts.push_str(&sub.to_string());
    }
    parts
}

#[tauri::command]
async fn submit_form(payload: serde_json::Value) -> Result<agent_ipc::SubmitFormAckPayload, String> {
    let payload: agent_ipc::SubmitFormPayload =
        serde_json::from_value(payload).map_err(|e| format!("Invalid payload: {}", e))?;
    ipc_client::submit_form(payload).await
}

#[tauri::command]
async fn get_tickets(os_user_sid: Option<String>) -> Result<agent_ipc::TicketListPayload, String> {
    log_to_file(String::from("INFO"), String::from("get_tickets command invoked"));
    ipc_client::get_tickets(os_user_sid).await
}

#[tauri::command]
async fn add_ticket_note(
    ticket_id: String,
    note: String,
    os_username: String,
    os_user_sid: Option<String>,
    attachments: Vec<agent_ipc::NoteAttachmentPayload>,
) -> Result<agent_ipc::TicketNoteAckPayload, String> {
    log_to_file(
        String::from("INFO"),
        format!("add_ticket_note command invoked for ticket {}", ticket_id),
    );
    ipc_client::add_ticket_note(
        ticket_id,
        note,
        agent_ipc::OsUserPayload {
            username: os_username,
            sid: os_user_sid,
            display_name: None,
        },
        attachments,
    )
    .await
}

#[tauri::command]
async fn get_ticket_detail(ticket_id: String) -> Result<agent_ipc::TicketDetailPayload, String> {
    log_to_file(
        String::from("INFO"),
        format!("get_ticket_detail command invoked for ticket {}", ticket_id),
    );
    ipc_client::get_ticket_detail(ticket_id).await
}

#[tauri::command]
async fn get_pending_events(app: AppHandle) -> Result<(), String> {
    let payload = ipc_client::get_pending_events().await?;
    for event in payload.events {
        let _ = app.emit("push-event", &event);
    }
    Ok(())
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    log_to_file(String::from("INFO"), format!("read_file_text command invoked for: {}", path));
    std::fs::read_to_string(&path).map_err(|e| {
        let err_msg = format!("Failed to read file {}: {}", path, e);
        log_to_file(String::from("ERROR"), err_msg.clone());
        err_msg
    })
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    log_to_file(String::from("INFO"), format!("read_file_base64 command invoked for: {}", path));
    std::fs::read(&path)
        .map_err(|e| {
            let err_msg = format!("Failed to read file {}: {}", path, e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })
        .map(|bytes| {
            log_to_file(String::from("INFO"), format!("Successfully encoded {} bytes to base64", bytes.len()));
            general_purpose::STANDARD.encode(bytes)
        })
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    log_to_file(String::from("INFO"), format!("read_file_binary command invoked for: {}", path));
    std::fs::read(&path)
        .map_err(|e| {
            let err_msg = format!("Failed to read file {}: {}", path, e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })
        .map(|bytes| {
            log_to_file(String::from("INFO"), format!("Successfully read {} bytes as binary", bytes.len()));
            bytes
        })
}

#[tauri::command]
fn read_registry_value(_path: &str, _key: &str) -> Result<String, String> {
    log_to_file(String::from("INFO"), format!("read_registry_value command invoked: path={}, key={}", _path, _key));

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let subkey = hklm.open_subkey(_path).map_err(|e| {
            let err_msg = format!("Failed to open registry path {}: {}", _path, e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })?;
        let result: String = subkey.get_value(_key).map_err(|e| {
            let err_msg = format!("Failed to read registry key {}: {}", _key, e);
            log_to_file(String::from("ERROR"), err_msg.clone());
            err_msg
        })?;
        log_to_file(String::from("INFO"), format!("Successfully read registry value for {}/{}", _path, _key));
        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let err_msg = String::from("Registry only works on Windows");
        log_to_file(String::from("ERROR"), err_msg.clone());
        Err(err_msg)
    }
}

#[tauri::command]
async fn get_os_info() -> Result<HeartbeatRequest, String> {
    gather_system_info().await.map_err(|e| format!("Failed to get system info: {}", e))
}

#[tauri::command]
async fn get_rmm_id() -> Result<String, String> {
    match get_rmm_device_id() {
        Some(id) => Ok(id),
        None => Err("Failed to get key".into()),
    }
}

// ── SSO cache ────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct SsoCache {
    provider: String,
    client_id: String,
    upn: String,
    oid: Option<String>,
    tenant_id: Option<String>,
    display_name: Option<String>,
    id_token: String,
    access_token: String,
    refresh_token: Option<String>,
    /// Unix timestamp after which the tokens should be refreshed.
    expires_at: i64,
}

fn sso_cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("sso_cache.json"))
}

fn read_sso_cache(app: &AppHandle) -> Option<SsoCache> {
    let bytes = std::fs::read(sso_cache_path(app)?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_sso_cache(app: &AppHandle, cache: &SsoCache) {
    if let Some(path) = sso_cache_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_vec_pretty(cache) {
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                use std::io::Write;
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .mode(0o600)
                    .open(path)
                {
                    let _ = file.write_all(&json);
                }
            }
            #[cfg(not(unix))]
            {
                // Windows app-data inherits the current user's ACL. A future
                // broker-backed flow can move refresh tokens into WAM itself.
                let _ = std::fs::write(path, json);
            }
        }
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn generate_code_verifier() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..64).map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char).collect()
}

fn generate_code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize())
}

fn decode_jwt_claims(token: &str) -> Result<serde_json::Value, String> {
    let payload = token.split('.').nth(1).ok_or("Invalid JWT")?;
    let decoded = general_purpose::URL_SAFE_NO_PAD.decode(payload)
        .or_else(|_| general_purpose::STANDARD.decode(payload))
        .map_err(|e| format!("JWT decode error: {}", e))?;
    serde_json::from_slice(&decoded).map_err(|e| format!("JWT parse error: {}", e))
}

async fn exchange_code_for_tokens(
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<SsoCache, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("redirect_uri", redirect_uri),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Token response parse failed: {}", e))?;

    if let Some(err) = resp.get("error") {
        let desc = resp.get("error_description").and_then(|v| v.as_str()).unwrap_or("unknown");
        return Err(format!("Entra error {}: {}", err, desc));
    }

    let id_token = resp["id_token"].as_str().ok_or("No id_token")?.to_string();
    let access_token = resp["access_token"].as_str().ok_or("No access_token")?.to_string();
    let refresh_token = resp["refresh_token"].as_str().map(|s| s.to_string());
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);

    let claims = decode_jwt_claims(&id_token)?;
    let upn = claims.get("preferred_username")
        .or_else(|| claims.get("upn"))
        .or_else(|| claims.get("email"))
        .and_then(|v| v.as_str())
        .ok_or("No UPN/email in ID token")?
        .to_string();

    Ok(SsoCache {
        provider: "entra".into(),
        client_id: client_id.to_string(),
        upn,
        oid: claims.get("oid").and_then(|v| v.as_str()).map(|s| s.to_string()),
        tenant_id: claims.get("tid").and_then(|v| v.as_str()).map(|s| s.to_string()),
        display_name: claims.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        id_token,
        access_token,
        refresh_token,
        expires_at: unix_now() + expires_in,
    })
}

async fn try_refresh_token(cache: &SsoCache) -> Result<SsoCache, String> {
    let refresh_token = cache.refresh_token.as_deref().ok_or("No refresh token")?;
    let client = reqwest::Client::new();
    let resp = client
        .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", cache.client_id.as_str()),
            ("scope", "openid profile email offline_access"),
        ])
        .send()
        .await
        .map_err(|e| format!("Refresh request failed: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Refresh parse failed: {}", e))?;

    if resp.get("error").is_some() {
        return Err("Refresh token rejected".into());
    }

    let id_token = resp["id_token"].as_str().ok_or("No id_token in refresh response")?.to_string();
    let access_token = resp["access_token"].as_str().ok_or("No access_token in refresh response")?.to_string();
    let new_refresh = resp["refresh_token"].as_str().map(|s| s.to_string()).or_else(|| cache.refresh_token.clone());
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);

    Ok(SsoCache {
        id_token,
        access_token,
        refresh_token: new_refresh,
        expires_at: unix_now() + expires_in,
        ..cache.clone()
    })
}

async fn handle_oauth_callback(
    listener: tokio::net::TcpListener,
    verifier: String,
    redirect_uri: String,
    client_id: String,
    expected_state: String,
) -> Result<SsoCache, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut stream, _) = listener.accept().await
        .map_err(|e| format!("Callback accept failed: {}", e))?;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await
        .map_err(|e| format!("Callback read failed: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Always send a response so the browser tab closes cleanly.
    let body = "<html><body style='font-family:sans-serif;padding:2rem'><h2>Authentication complete.</h2><p>You can close this tab.</p></body></html>";
    let _ = stream.write_all(
        format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()
    ).await;
    drop(stream);

    // Parse the request line: "GET /callback?... HTTP/1.1"
    let path_and_query = request.lines().next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");
    let query = path_and_query.split('?').nth(1).unwrap_or("");

    let mut code: Option<String> = None;
    let mut returned_state: Option<String> = None;
    let mut auth_error: Option<String> = None;

    for param in query.split('&') {
        if let Some(v) = param.strip_prefix("code=") {
            code = Some(v.replace('+', " ").replace("%3D", "=").replace("%2B", "+"));
        } else if let Some(v) = param.strip_prefix("state=") {
            returned_state = Some(v.to_string());
        } else if let Some(v) = param.strip_prefix("error_description=") {
            auth_error = Some(v.replace('+', " ").replace("%20", " "));
        } else if param.starts_with("error=") && auth_error.is_none() {
            auth_error = Some(param.to_string());
        }
    }

    if let Some(e) = auth_error {
        return Err(format!("Provider returned error: {}", e));
    }
    if returned_state.as_deref() != Some(&expected_state) {
        return Err("State mismatch — possible CSRF".into());
    }
    let code = code.ok_or("No authorization code in callback")?;

    exchange_code_for_tokens(&client_id, &code, &verifier, &redirect_uri).await
}

#[tauri::command]
async fn start_entra_auth(app: AppHandle) -> Result<(), String> {
    // Client ID comes from the server-side bundle, not the frontend.
    let client_id = ipc_client::get_config_bundle()
        .await
        .ok()
        .and_then(|p| p.bundle)
        .and_then(|b| b.get("entraClientId").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .ok_or("Entra SSO is not configured on this server")?;

    let std_listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind callback server: {}", e))?;
    let port = std_listener.local_addr()
        .map_err(|e| format!("Failed to get callback port: {}", e))?.port();
    std_listener.set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking: {}", e))?;
    let tokio_listener = tokio::net::TcpListener::from_std(std_listener)
        .map_err(|e| format!("Failed to create async listener: {}", e))?;

    let verifier = generate_code_verifier();
    let challenge = generate_code_challenge(&verifier);
    let state: String = {
        use rand::Rng;
        rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric).take(16).map(char::from).collect()
    };

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    // Percent-encode the redirect_uri for use as a query parameter value.
    let redirect_uri_enc = format!("http%3A%2F%2F127.0.0.1%3A{}%2Fcallback", port);

    let auth_url = format!(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize\
?client_id={client_id}&response_type=code&redirect_uri={redir}\
&scope=openid%20profile%20email%20offline_access\
&code_challenge={challenge}&code_challenge_method=S256\
&state={state}&response_mode=query",
        client_id = client_id,
        redir = redirect_uri_enc,
        challenge = challenge,
        state = state,
    );

    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tokio::time::timeout(
            tokio::time::Duration::from_secs(300),
            handle_oauth_callback(tokio_listener, verifier, redirect_uri, client_id, state),
        ).await;

        match result {
            Ok(Ok(cache)) => {
                write_sso_cache(&app_clone, &cache);
                let payload = serde_json::json!({
                    "upn": cache.upn,
                    "tenant_id": cache.tenant_id,
                    "display_name": cache.display_name,
                });
                // Prefer the about window directly — app.emit() can be missed
                // when the webview is hidden/throttled behind the browser.
                if let Some(win) = app_clone.get_webview_window("about") {
                    let _ = win.emit("entra-auth-complete", &payload);
                }
                let _ = app_clone.emit("entra-auth-complete", &payload);
            }
            Ok(Err(e)) => {
                log_to_file("ERROR".into(), format!("Entra auth failed: {}", e));
                if let Some(win) = app_clone.get_webview_window("about") {
                    let _ = win.emit("entra-auth-error", &e);
                }
                let _ = app_clone.emit("entra-auth-error", &e);
            }
            Err(_) => {
                let msg = "Authentication timed out";
                if let Some(win) = app_clone.get_webview_window("about") {
                    let _ = win.emit("entra-auth-error", msg);
                }
                let _ = app_clone.emit("entra-auth-error", msg);
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn get_cached_sso_token(app: AppHandle) -> Result<Option<String>, String> {
    let cache = match read_sso_cache(&app) {
        Some(c) => c,
        None => return Ok(None),
    };

    // Token valid with 60s buffer
    if cache.expires_at > unix_now() + 60 {
        return Ok(Some(cache.id_token));
    }

    // Attempt silent refresh
    match try_refresh_token(&cache).await {
        Ok(refreshed) => {
            write_sso_cache(&app, &refreshed);
            Ok(Some(refreshed.id_token))
        }
        Err(e) => {
            log_to_file("WARN".into(), format!("Token refresh failed, re-auth required: {}", e));
            let _ = app.emit("entra-auth-required", "Token expired and could not be refreshed");
            Ok(None)
        }
    }
}

#[tauri::command]
async fn clear_entra_auth(app: AppHandle) -> Result<(), String> {
    if let Some(path) = sso_cache_path(&app) {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to clear SSO cache: {}", e))?;
        }
    }
    Ok(())
}

// ── Entra SSO status ─────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct EntraSsoStatus {
    pub device_aad_joined: bool,
    pub user_prt_present: bool,
    pub upn: Option<String>,
    pub tenant_id: Option<String>,
    /// How the status was obtained — informs UI context messages.
    pub source: String,
}

#[tauri::command]
async fn get_entra_sso_status(app: AppHandle) -> Result<EntraSsoStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let output = Command::new("dsregcmd")
            .arg("/status")
            .output()
            .map_err(|e| format!("dsregcmd failed: {}", e))?;

        let text = String::from_utf8_lossy(&output.stdout).to_string();

        fn find_val(text: &str, key: &str) -> Option<String> {
            text.lines()
                .find(|l| l.trim_start().starts_with(key))
                .and_then(|l| l.splitn(2, ':').nth(1))
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        }

        let user_prt = find_val(&text, "AzureAdPrt").as_deref() == Some("YES");

        // If device has no active PRT, also check the PKCE cache (BYOD scenario).
        if !user_prt {
            if let Some(status) = cached_sso_status(&app) {
                return Ok(status);
            }
        }

        return Ok(EntraSsoStatus {
            device_aad_joined: find_val(&text, "AzureAdJoined").as_deref() == Some("YES"),
            user_prt_present: user_prt,
            upn: find_val(&text, "UserEmail"),
            tenant_id: find_val(&text, "TenantId"),
            source: "dsregcmd".into(),
        });
    }

    // On macOS / Linux, try Azure CLI then fall back to PKCE cache.
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;

        if let Ok(out) = Command::new("az").args(["account", "show", "--output", "json"]).output() {
            if out.status.success() {
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                    let upn = json.get("user")
                        .and_then(|u| u.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let tenant_id = json.get("tenantId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let authenticated = upn.is_some();
                    return Ok(EntraSsoStatus {
                        device_aad_joined: false,
                        user_prt_present: authenticated,
                        upn,
                        tenant_id,
                        source: "az_cli".into(),
                    });
                }
            }
        }

        if let Some(status) = cached_sso_status(&app) {
            return Ok(status);
        }

        Ok(EntraSsoStatus {
            device_aad_joined: false,
            user_prt_present: false,
            upn: None,
            tenant_id: None,
            source: "unavailable".into(),
        })
    }
}

fn cached_sso_status(app: &AppHandle) -> Option<EntraSsoStatus> {
    let cache = read_sso_cache(app)?;
    let valid = cache.expires_at > unix_now();
    Some(EntraSsoStatus {
        device_aad_joined: false,
        user_prt_present: valid,
        upn: Some(cache.upn),
        tenant_id: cache.tenant_id,
        source: "cached".into(),
    })
}
