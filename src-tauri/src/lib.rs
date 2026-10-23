use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, process::Command, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

const CREDENTIAL_SERVICE: &str = "StreamDash";
const PREFERENCES_REGISTRY_KEY: &str = r"HKCU\Software\Tenkayro\StreamDash";

struct AppState { db: Mutex<Connection> }

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityRecord {
    id: String, source: String, event_type: String, username: Option<String>,
    display_name: Option<String>, timestamp: String, amount: Option<f64>,
    currency: Option<String>, message: Option<String>, tier: Option<String>,
    gift_count: Option<i64>, bits: Option<i64>, viewer_count: Option<i64>, metadata: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct TwitchTokens {
    access_token: String, refresh_token: Option<String>, expires_at: i64, scope: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TwitchSession { user_id: String, login: String, scopes: Vec<String>, expires_in: i64 }

fn now_epoch() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

fn credential(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, name).map_err(|e| e.to_string())
}

fn save_secret(name: &str, value: &str) -> Result<(), String> {
    credential(name)?.set_password(value).map_err(|e| e.to_string())
}

fn load_secret(name: &str) -> Result<Option<String>, String> {
    match credential(name)?.get_password() {
        Ok(value) => Ok(Some(value)), Err(keyring::Error::NoEntry) => Ok(None), Err(e) => Err(e.to_string()),
    }
}

fn delete_secret_value(name: &str) -> Result<(), String> {
    match credential(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
fn set_keep_user_data_preference(keep: bool) -> Result<(), String> {
    let status = Command::new("reg.exe")
        .args(["add", PREFERENCES_REGISTRY_KEY, "/v", "KeepUserData", "/t", "REG_SZ", "/d", if keep { "1" } else { "0" }, "/f"])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("Could not update the uninstall preference".into()) }
}

#[cfg(not(windows))]
fn set_keep_user_data_preference(_keep: bool) -> Result<(), String> { Ok(()) }

fn migrate_legacy_data(new_directory: &Path) -> Result<(), String> {
    let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) else { return Ok(()); };
    let legacy = roaming.join("dev.streamdash.desktop");
    if !legacy.exists() { return Ok(()); }
    std::fs::create_dir_all(new_directory).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(&legacy).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let destination = new_directory.join(entry.file_name());
        if !destination.exists() {
            std::fs::rename(entry.path(), destination).map_err(|e| format!("Could not migrate StreamDash data: {e}"))?;
        }
    }
    let _ = std::fs::remove_dir(&legacy);
    Ok(())
}

fn remove_directory_if_present(path: PathBuf) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("Could not remove {}: {e}", path.display()))?;
    }
    Ok(())
}

pub fn uninstall_cleanup() -> Result<(), String> {
    delete_secret_value("twitch-oauth")?;
    delete_secret_value("streamelements-token")?;

    if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
        remove_directory_if_present(roaming.join("StreamDash"))?;
        remove_directory_if_present(roaming.join("dev.streamdash.desktop"))?;
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        remove_directory_if_present(local.join("StreamDash"))?;
        remove_directory_if_present(local.join("dev.streamdash.desktop"))?;
    }

    for value in ["StreamDash", "streamdash"] {
        let _ = Command::new("reg.exe").args(["delete", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", value, "/f"]).status();
    }
    let _ = Command::new("reg.exe").args(["delete", PREFERENCES_REGISTRY_KEY, "/f"]).status();
    Ok(())
}

fn load_twitch_tokens() -> Result<TwitchTokens, String> {
    let raw = load_secret("twitch-oauth")?.ok_or("Twitch is not connected")?;
    serde_json::from_str(&raw).map_err(|_| "Stored Twitch credentials are invalid".to_string())
}

fn store_twitch_tokens(tokens: &TwitchTokens) -> Result<(), String> {
    save_secret("twitch-oauth", &serde_json::to_string(tokens).map_err(|e| e.to_string())?)
}

fn init_database(path: PathBuf) -> Result<Connection, String> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS activity_events (
           id TEXT PRIMARY KEY, source TEXT NOT NULL, event_type TEXT NOT NULL,
           username TEXT, display_name TEXT, timestamp TEXT NOT NULL,
           amount REAL, currency TEXT, message TEXT, tier TEXT,
           gift_count INTEGER, bits INTEGER, viewer_count INTEGER,
           metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_events(timestamp DESC);
         CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_events(event_type);
         CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
    ).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
fn events_list(state: tauri::State<'_, AppState>, limit: Option<u32>) -> Result<Vec<ActivityRecord>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed")?;
    let mut stmt = conn.prepare(
        "SELECT id,source,event_type,username,display_name,timestamp,amount,currency,message,tier,gift_count,bits,viewer_count,metadata
         FROM activity_events ORDER BY timestamp DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([limit.unwrap_or(1000).min(10000)], |row| {
        let raw: String = row.get(13)?;
        Ok(ActivityRecord {
            id: row.get(0)?, source: row.get(1)?, event_type: row.get(2)?, username: row.get(3)?,
            display_name: row.get(4)?, timestamp: row.get(5)?, amount: row.get(6)?, currency: row.get(7)?,
            message: row.get(8)?, tier: row.get(9)?, gift_count: row.get(10)?, bits: row.get(11)?,
            viewer_count: row.get(12)?, metadata: serde_json::from_str(&raw).unwrap_or(json!({})),
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn event_insert(state: tauri::State<'_, AppState>, event: ActivityRecord, max_events: u32) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed")?;
    let changed = conn.execute(
        "INSERT OR IGNORE INTO activity_events
         (id,source,event_type,username,display_name,timestamp,amount,currency,message,tier,gift_count,bits,viewer_count,metadata,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![event.id,event.source,event.event_type,event.username,event.display_name,event.timestamp,event.amount,event.currency,
          event.message,event.tier,event.gift_count,event.bits,event.viewer_count,event.metadata.to_string(),now_epoch()]
    ).map_err(|e| e.to_string())?;
    let keep = max_events.clamp(100, 50_000);
    conn.execute("DELETE FROM activity_events WHERE id IN (SELECT id FROM activity_events ORDER BY timestamp DESC LIMIT -1 OFFSET ?1)", [keep])
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

#[tauri::command]
fn events_clear(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.db.lock().map_err(|_| "Database lock failed")?.execute("DELETE FROM activity_events", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn settings_load(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed")?;
    let mut stmt = conn.prepare("SELECT key,value FROM settings").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?))).map_err(|e| e.to_string())?;
    let mut map = serde_json::Map::new();
    for row in rows {
        let (key, raw) = row.map_err(|e| e.to_string())?;
        map.insert(key, serde_json::from_str(&raw).unwrap_or(Value::String(raw)));
    }
    Ok(Value::Object(map))
}

#[tauri::command]
fn setting_save(state: tauri::State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    state.db.lock().map_err(|_| "Database lock failed")?.execute(
        "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value.to_string()],
    ).map_err(|e| e.to_string())?;
    if key == "keepUserData" {
        set_keep_user_data_preference(value.as_bool().unwrap_or(true))?;
    }
    Ok(())
}

#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    if name != "streamelements-token" { return Err("Unsupported credential key".into()); }
    save_secret(&name, &value)
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    if name != "streamelements-token" { return Err("Unsupported credential key".into()); }
    load_secret(&name)
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    if !matches!(name.as_str(), "streamelements-token" | "twitch-oauth") { return Err("Unsupported credential key".into()); }
    delete_secret_value(&name)
}

#[tauri::command]
async fn twitch_device_start(client_id: String, scopes: Vec<String>) -> Result<Value, String> {
    let response = reqwest::Client::new().post("https://id.twitch.tv/oauth2/device")
        .form(&[("client_id", client_id), ("scopes", scopes.join(" "))]).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(body.get("message").and_then(Value::as_str).unwrap_or("Twitch authorization failed").to_string()); }
    Ok(body)
}

#[tauri::command]
async fn twitch_device_poll(client_id: String, device_code: String, scopes: Vec<String>) -> Result<Value, String> {
    let response = reqwest::Client::new().post("https://id.twitch.tv/oauth2/token")
        .form(&[("client_id", client_id), ("scopes", scopes.join(" ")), ("device_code", device_code),
          ("grant_type", "urn:ietf:params:oauth:grant-type:device_code".to_string())])
        .send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        let tokens = TwitchTokens {
            access_token: body["access_token"].as_str().ok_or("Missing access token")?.to_string(),
            refresh_token: body["refresh_token"].as_str().map(str::to_string),
            expires_at: now_epoch() + body["expires_in"].as_i64().unwrap_or(14_000),
            scope: body["scope"].as_array().map(|v| v.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or(scopes),
        };
        store_twitch_tokens(&tokens)?;
        return Ok(json!({"status":"authorized"}));
    }
    let message = body.get("message").and_then(Value::as_str).unwrap_or("authorization_pending");
    if message.contains("authorization_pending") { Ok(json!({"status":"pending"})) }
    else if message.contains("slow_down") { Ok(json!({"status":"slow_down"})) }
    else { Err(message.to_string()) }
}

async fn refresh_twitch(client_id: &str, current: TwitchTokens) -> Result<TwitchTokens, String> {
    let refresh = current.refresh_token.ok_or("Twitch session expired; reconnect required")?;
    let response = reqwest::Client::new().post("https://id.twitch.tv/oauth2/token")
        .form(&[("grant_type", "refresh_token"), ("refresh_token", refresh.as_str()), ("client_id", client_id)])
        .send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err("Twitch session expired; reconnect required".into()); }
    let updated = TwitchTokens {
        access_token: body["access_token"].as_str().ok_or("Missing refreshed access token")?.to_string(),
        refresh_token: body["refresh_token"].as_str().map(str::to_string).or(Some(refresh)),
        expires_at: now_epoch() + body["expires_in"].as_i64().unwrap_or(14_000),
        scope: body["scope"].as_array().map(|v| v.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or(current.scope),
    };
    store_twitch_tokens(&updated)?;
    Ok(updated)
}

async fn valid_tokens(client_id: &str) -> Result<TwitchTokens, String> {
    let tokens = load_twitch_tokens()?;
    if tokens.expires_at <= now_epoch() + 120 { refresh_twitch(client_id, tokens).await } else { Ok(tokens) }
}

#[tauri::command]
async fn twitch_session(client_id: String) -> Result<Option<TwitchSession>, String> {
    let tokens = match load_twitch_tokens() { Ok(v) => v, Err(_) => return Ok(None) };
    let tokens = if tokens.expires_at <= now_epoch() + 120 { refresh_twitch(&client_id, tokens).await? } else { tokens };
    let response = reqwest::Client::new().get("https://id.twitch.tv/oauth2/validate")
        .bearer_auth(&tokens.access_token).send().await.map_err(|e| e.to_string())?;
    if response.status().as_u16() == 401 { delete_secret_value("twitch-oauth")?; return Ok(None); }
    let value: Value = response.json().await.map_err(|e| e.to_string())?;
    if value["client_id"].as_str() != Some(client_id.as_str()) {
        delete_secret_value("twitch-oauth")?;
        return Ok(None);
    }
    Ok(Some(TwitchSession {
        user_id: value["user_id"].as_str().unwrap_or_default().to_string(), login: value["login"].as_str().unwrap_or_default().to_string(),
        scopes: value["scopes"].as_array().map(|v| v.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        expires_in: value["expires_in"].as_i64().unwrap_or_default(),
    }))
}

#[tauri::command]
async fn twitch_helix_get(client_id: String, path: String, query: Vec<(String,String)>) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") { return Err("Invalid Helix path".into()); }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!("https://api.twitch.tv/helix/{}", path.trim_start_matches('/'));
    let response = reqwest::Client::new().get(url).query(&query).header("Client-Id", client_id)
        .bearer_auth(tokens.access_token).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(body["message"].as_str().unwrap_or("Twitch API request failed").to_string()); }
    Ok(body)
}

#[tauri::command]
async fn twitch_helix_patch(client_id: String, path: String, query: Vec<(String,String)>, body: Value) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") { return Err("Invalid Helix path".into()); }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!("https://api.twitch.tv/helix/{}", path.trim_start_matches('/'));
    let response = reqwest::Client::new().patch(url).query(&query).header("Client-Id", client_id)
        .bearer_auth(tokens.access_token).json(&body).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 204 { return Ok(json!({})); }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(body["message"].as_str().unwrap_or("Twitch API request failed").to_string()); }
    Ok(body)
}

#[tauri::command]
async fn twitch_helix_post(client_id: String, path: String, query: Vec<(String,String)>, body: Value) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") { return Err("Invalid Helix path".into()); }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!("https://api.twitch.tv/helix/{}", path.trim_start_matches('/'));
    let response = reqwest::Client::new().post(url).query(&query).header("Client-Id", client_id)
        .bearer_auth(tokens.access_token).json(&body).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 204 { return Ok(json!({})); }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(body["message"].as_str().unwrap_or("Twitch API request failed").to_string()); }
    Ok(body)
}

#[tauri::command]
async fn twitch_eventsub_create(client_id: String, body: Value) -> Result<(), String> {
    let tokens = valid_tokens(&client_id).await?;
    let response = reqwest::Client::new().post("https://api.twitch.tv/helix/eventsub/subscriptions")
        .header("Client-Id", client_id).bearer_auth(tokens.access_token).json(&body).send().await.map_err(|e| e.to_string())?;
    if response.status().is_success() || response.status().as_u16() == 409 { return Ok(()); }
    let body: Value = response.json().await.unwrap_or(json!({}));
    Err(body["message"].as_str().unwrap_or("Could not create EventSub subscription").to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let db_path = app.path().app_data_dir()?.join("streamdash.db");
            if let Some(data_directory) = db_path.parent() {
                migrate_legacy_data(data_directory).map_err(std::io::Error::other)?;
            }
            app.manage(AppState { db: Mutex::new(init_database(db_path).map_err(std::io::Error::other)?) });
            if cfg!(debug_assertions) { app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?; }
            let open = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
            let reconnect = MenuItem::with_id(app, "reconnect", "Reconnect Services", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &reconnect, &settings, &quit])?;
            let tray_icon = app.default_window_icon().cloned().ok_or_else(|| std::io::Error::other("StreamDash application icon is missing"))?;
            TrayIconBuilder::new().icon(tray_icon).menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => { if let Some(w) = app.get_webview_window("main") { let _=w.show(); let _=w.set_focus(); } },
                    "reconnect" => { let _=app.emit("tray-reconnect", ()); },
                    "settings" => { if let Some(w)=app.get_webview_window("main") { let _=w.show(); let _=w.set_focus(); } let _=app.emit("tray-settings", ()); },
                    "quit" => app.exit(0), _ => {}
                }).build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![events_list,event_insert,events_clear,settings_load,setting_save,
          secret_set,secret_get,secret_delete,twitch_device_start,twitch_device_poll,twitch_session,twitch_helix_get,twitch_helix_patch,twitch_helix_post,twitch_eventsub_create])
        .run(tauri::generate_context!()).expect("error while building StreamDash");
}
