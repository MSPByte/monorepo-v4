mod device_manager;
mod heartbeat;
mod ipc_client;
mod logger;

use base64::engine::general_purpose;
use base64::Engine;
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
            get_pending_events
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
            .inner_size(300.0, 300.0)
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
