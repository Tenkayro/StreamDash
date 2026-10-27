use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const CREDENTIAL_SERVICE: &str = "StreamDash";
const PREFERENCES_REGISTRY_KEY: &str = r"HKCU\Software\Tenkayro\StreamDash";

struct AppState {
    db: Mutex<Connection>,
}

struct TrayState {
    custom: AtomicBool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayMenuConfig {
    mode: String,
    status: String,
    open: String,
    dashboard: String,
    stream: String,
    chat: String,
    activity: String,
    reconnect: String,
    settings: String,
    quit: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityRecord {
    id: String,
    source: String,
    event_type: String,
    username: Option<String>,
    display_name: Option<String>,
    timestamp: String,
    amount: Option<f64>,
    currency: Option<String>,
    message: Option<String>,
    tier: Option<String>,
    gift_count: Option<i64>,
    bits: Option<i64>,
    viewer_count: Option<i64>,
    metadata: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct TwitchTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: i64,
    scope: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TwitchSession {
    user_id: String,
    login: String,
    scopes: Vec<String>,
    expires_in: i64,
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn credential(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, name).map_err(|e| e.to_string())
}

fn save_secret(name: &str, value: &str) -> Result<(), String> {
    credential(name)?
        .set_password(value)
        .map_err(|e| e.to_string())
}

fn load_secret(name: &str) -> Result<Option<String>, String> {
    match credential(name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_secret_value(name: &str) -> Result<(), String> {
    match credential(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
fn set_keep_user_data_preference(keep: bool) -> Result<(), String> {
    let status = Command::new("reg.exe")
        .args([
            "add",
            PREFERENCES_REGISTRY_KEY,
            "/v",
            "KeepUserData",
            "/t",
            "REG_SZ",
            "/d",
            if keep { "1" } else { "0" },
            "/f",
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not update the uninstall preference".into())
    }
}

#[cfg(not(windows))]
fn set_keep_user_data_preference(_keep: bool) -> Result<(), String> {
    Ok(())
}

fn migrate_legacy_data(new_directory: &Path) -> Result<(), String> {
    let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) else {
        return Ok(());
    };
    let legacy = roaming.join("dev.streamdash.desktop");
    if !legacy.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(new_directory).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(&legacy).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let destination = new_directory.join(entry.file_name());
        if !destination.exists() {
            std::fs::rename(entry.path(), destination)
                .map_err(|e| format!("Could not migrate StreamDash data: {e}"))?;
        }
    }
    let _ = std::fs::remove_dir(&legacy);
    Ok(())
}

fn remove_directory_if_present(path: PathBuf) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Could not remove {}: {e}", path.display()))?;
    }
    Ok(())
}

pub fn uninstall_cleanup() -> Result<(), String> {
    for secret in [
        "twitch-oauth",
        "streamelements-token",
        "tipeeestream-api-key",
        "obs-password",
    ] {
        delete_secret_value(secret)?;
    }

    if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
        remove_directory_if_present(roaming.join("StreamDash"))?;
        remove_directory_if_present(roaming.join("dev.streamdash.desktop"))?;
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        remove_directory_if_present(local.join("StreamDash"))?;
        remove_directory_if_present(local.join("dev.streamdash.desktop"))?;
    }

    for value in ["StreamDash", "streamdash"] {
        let _ = Command::new("reg.exe")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                value,
                "/f",
            ])
            .status();
    }
    let _ = Command::new("reg.exe")
        .args(["delete", PREFERENCES_REGISTRY_KEY, "/f"])
        .status();
    Ok(())
}

fn load_twitch_tokens() -> Result<TwitchTokens, String> {
    let raw = load_secret("twitch-oauth")?.ok_or("Twitch is not connected")?;
    serde_json::from_str(&raw).map_err(|_| "Stored Twitch credentials are invalid".to_string())
}

fn store_twitch_tokens(tokens: &TwitchTokens) -> Result<(), String> {
    save_secret(
        "twitch-oauth",
        &serde_json::to_string(tokens).map_err(|e| e.to_string())?,
    )
}

fn init_database(path: PathBuf) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
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
         CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
fn events_list(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<ActivityRecord>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed")?;
    let mut stmt = conn.prepare(
        "SELECT id,source,event_type,username,display_name,timestamp,amount,currency,message,tier,gift_count,bits,viewer_count,metadata
         FROM activity_events ORDER BY timestamp DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit.unwrap_or(1000).min(50_000)], |row| {
            let raw: String = row.get(13)?;
            Ok(ActivityRecord {
                id: row.get(0)?,
                source: row.get(1)?,
                event_type: row.get(2)?,
                username: row.get(3)?,
                display_name: row.get(4)?,
                timestamp: row.get(5)?,
                amount: row.get(6)?,
                currency: row.get(7)?,
                message: row.get(8)?,
                tier: row.get(9)?,
                gift_count: row.get(10)?,
                bits: row.get(11)?,
                viewer_count: row.get(12)?,
                metadata: serde_json::from_str(&raw).unwrap_or(json!({})),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn event_insert(
    state: tauri::State<'_, AppState>,
    event: ActivityRecord,
    max_events: u32,
) -> Result<bool, String> {
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
    state
        .db
        .lock()
        .map_err(|_| "Database lock failed")?
        .execute("DELETE FROM activity_events", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn settings_load(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed")?;
    let mut stmt = conn
        .prepare("SELECT key,value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut map = serde_json::Map::new();
    for row in rows {
        let (key, raw) = row.map_err(|e| e.to_string())?;
        map.insert(
            key,
            serde_json::from_str(&raw).unwrap_or(Value::String(raw)),
        );
    }
    Ok(Value::Object(map))
}

#[tauri::command]
fn setting_save(
    state: tauri::State<'_, AppState>,
    key: String,
    value: Value,
) -> Result<(), String> {
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
    if !matches!(
        name.as_str(),
        "streamelements-token" | "tipeeestream-api-key" | "obs-password"
    ) {
        return Err("Unsupported credential key".into());
    }
    save_secret(&name, &value)
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    if !matches!(
        name.as_str(),
        "streamelements-token" | "tipeeestream-api-key" | "obs-password"
    ) {
        return Err("Unsupported credential key".into());
    }
    load_secret(&name)
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    if !matches!(
        name.as_str(),
        "streamelements-token"
            | "tipeeestream-api-key"
            | "obs-password"
            | "twitch-oauth"
    ) {
        return Err("Unsupported credential key".into());
    }
    delete_secret_value(&name)
}

#[tauri::command]
async fn twitch_device_start(client_id: String, scopes: Vec<String>) -> Result<Value, String> {
    let response = http()
        .post("https://id.twitch.tv/oauth2/device")
        .form(&[("client_id", client_id), ("scopes", scopes.join(" "))])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Twitch authorization failed")
            .to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn twitch_device_poll(
    client_id: String,
    device_code: String,
    scopes: Vec<String>,
) -> Result<Value, String> {
    let response = http()
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id", client_id),
            ("scopes", scopes.join(" ")),
            ("device_code", device_code),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code".to_string(),
            ),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        let tokens = TwitchTokens {
            access_token: body["access_token"]
                .as_str()
                .ok_or("Missing access token")?
                .to_string(),
            refresh_token: body["refresh_token"].as_str().map(str::to_string),
            expires_at: now_epoch() + body["expires_in"].as_i64().unwrap_or(14_000),
            scope: body["scope"]
                .as_array()
                .map(|v| {
                    v.iter()
                        .filter_map(|s| s.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or(scopes),
        };
        store_twitch_tokens(&tokens)?;
        return Ok(json!({"status":"authorized"}));
    }
    let message = body
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("authorization_pending");
    if message.contains("authorization_pending") {
        Ok(json!({"status":"pending"}))
    } else if message.contains("slow_down") {
        Ok(json!({"status":"slow_down"}))
    } else {
        Err(message.to_string())
    }
}

async fn refresh_twitch(client_id: &str, current: TwitchTokens) -> Result<TwitchTokens, String> {
    let refresh = current
        .refresh_token
        .ok_or("Twitch session expired; reconnect required")?;
    let response = http()
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err("Twitch session expired; reconnect required".into());
    }
    let updated = TwitchTokens {
        access_token: body["access_token"]
            .as_str()
            .ok_or("Missing refreshed access token")?
            .to_string(),
        refresh_token: body["refresh_token"]
            .as_str()
            .map(str::to_string)
            .or(Some(refresh)),
        expires_at: now_epoch() + body["expires_in"].as_i64().unwrap_or(14_000),
        scope: body["scope"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter_map(|s| s.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or(current.scope),
    };
    store_twitch_tokens(&updated)?;
    Ok(updated)
}

async fn valid_tokens(client_id: &str) -> Result<TwitchTokens, String> {
    let tokens = load_twitch_tokens()?;
    if tokens.expires_at <= now_epoch() + 120 {
        refresh_twitch(client_id, tokens).await
    } else {
        Ok(tokens)
    }
}

#[tauri::command]
async fn twitch_session(client_id: String) -> Result<Option<TwitchSession>, String> {
    let tokens = match load_twitch_tokens() {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let tokens = if tokens.expires_at <= now_epoch() + 120 {
        refresh_twitch(&client_id, tokens).await?
    } else {
        tokens
    };
    let response = http()
        .get("https://id.twitch.tv/oauth2/validate")
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status().as_u16() == 401 {
        delete_secret_value("twitch-oauth")?;
        return Ok(None);
    }
    let value: Value = response.json().await.map_err(|e| e.to_string())?;
    if value["client_id"].as_str() != Some(client_id.as_str()) {
        delete_secret_value("twitch-oauth")?;
        return Ok(None);
    }
    Ok(Some(TwitchSession {
        user_id: value["user_id"].as_str().unwrap_or_default().to_string(),
        login: value["login"].as_str().unwrap_or_default().to_string(),
        scopes: value["scopes"]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter_map(|s| s.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        expires_in: value["expires_in"].as_i64().unwrap_or_default(),
    }))
}

#[tauri::command]
async fn twitch_helix_get(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") {
        return Err("Invalid Helix path".into());
    }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!(
        "https://api.twitch.tv/helix/{}",
        path.trim_start_matches('/')
    );
    let response = http()
        .get(url)
        .query(&query)
        .header("Client-Id", client_id)
        .bearer_auth(tokens.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body["message"]
            .as_str()
            .unwrap_or("Twitch API request failed")
            .to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn twitch_helix_patch(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") {
        return Err("Invalid Helix path".into());
    }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!(
        "https://api.twitch.tv/helix/{}",
        path.trim_start_matches('/')
    );
    let response = http()
        .patch(url)
        .query(&query)
        .header("Client-Id", client_id)
        .bearer_auth(tokens.access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(json!({}));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body["message"]
            .as_str()
            .unwrap_or("Twitch API request failed")
            .to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn twitch_helix_post(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") {
        return Err("Invalid Helix path".into());
    }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!(
        "https://api.twitch.tv/helix/{}",
        path.trim_start_matches('/')
    );
    let response = http()
        .post(url)
        .query(&query)
        .header("Client-Id", client_id)
        .bearer_auth(tokens.access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(json!({}));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body["message"]
            .as_str()
            .unwrap_or("Twitch API request failed")
            .to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn twitch_helix_put(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") {
        return Err("Invalid Helix path".into());
    }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!(
        "https://api.twitch.tv/helix/{}",
        path.trim_start_matches('/')
    );
    let response = http()
        .put(url)
        .query(&query)
        .header("Client-Id", client_id)
        .bearer_auth(tokens.access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(json!({}));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(body["message"]
            .as_str()
            .unwrap_or("Twitch API request failed")
            .to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn twitch_helix_delete(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    if path.contains("..") || path.contains("://") {
        return Err("Invalid Helix path".into());
    }
    let tokens = valid_tokens(&client_id).await?;
    let url = format!(
        "https://api.twitch.tv/helix/{}",
        path.trim_start_matches('/')
    );
    let response = http()
        .delete(url)
        .query(&query)
        .header("Client-Id", client_id)
        .bearer_auth(tokens.access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(json!({}));
    }
    let body: Value = response.json().await.unwrap_or(json!({}));
    if !status.is_success() {
        return Err(body["message"]
            .as_str()
            .unwrap_or("Twitch API request failed")
            .to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn twitch_eventsub_create(client_id: String, body: Value) -> Result<(), String> {
    let tokens = valid_tokens(&client_id).await?;
    let response = http()
        .post("https://api.twitch.tv/helix/eventsub/subscriptions")
        .header("Client-Id", client_id)
        .bearer_auth(tokens.access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status().is_success() || response.status().as_u16() == 409 {
        return Ok(());
    }
    let body: Value = response.json().await.unwrap_or(json!({}));
    Err(body["message"]
        .as_str()
        .unwrap_or("Could not create EventSub subscription")
        .to_string())
}

#[derive(Default)]
struct ChatIrc {
    sender: Mutex<Option<mpsc::UnboundedSender<String>>>,
}

#[tauri::command]
async fn twitch_chat_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ChatIrc>,
    client_id: String,
    login: String,
    channel: String,
    session: String,
) -> Result<(), String> {
    let tokens = valid_tokens(&client_id).await?;
    let (socket, _) = tokio_tungstenite::connect_async("wss://irc-ws.chat.twitch.tv:443")
        .await
        .map_err(|e| e.to_string())?;
    let (mut write, mut read) = socket.split();
    for line in [
        format!("PASS oauth:{}", tokens.access_token),
        "CAP REQ :twitch.tv/tags twitch.tv/commands".to_string(),
        format!("NICK {login}"),
        format!("JOIN #{channel}"),
    ] {
        write
            .send(Message::Text(line))
            .await
            .map_err(|e| e.to_string())?;
    }
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    *state
        .sender
        .lock()
        .map_err(|_| "Chat state is unavailable")? = Some(tx);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                incoming = read.next() => match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if text.starts_with("PING") {
                            if write.send(Message::Text("PONG :tmi.twitch.tv".to_string())).await.is_err() { break; }
                        } else if text.starts_with("RECONNECT") || text.starts_with(":tmi.twitch.tv RECONNECT") {
                            break;
                        } else {
                            let _ = app.emit("twitch-chat-line", json!({ "session": session.clone(), "line": text }));
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => { if write.send(Message::Pong(payload)).await.is_err() { break; } }
                    Some(Ok(_)) => {}
                    _ => break,
                },
                outgoing = rx.recv() => match outgoing {
                    Some(line) => { if write.send(Message::Text(line)).await.is_err() { break; } }
                    None => break,
                },
            }
        }
        let _ = app.emit("twitch-chat-closed", json!({ "session": session }));
    });
    Ok(())
}

#[tauri::command]
fn twitch_chat_send(
    state: tauri::State<'_, ChatIrc>,
    channel: String,
    message: String,
) -> Result<(), String> {
    if message.contains(['\r', '\n']) || channel.contains(['\r', '\n', ' ', '#']) {
        return Err("Invalid chat message".into());
    }
    let sender = state
        .sender
        .lock()
        .map_err(|_| "Chat state is unavailable")?;
    let sender = sender.as_ref().ok_or("Chat is not connected")?;
    sender
        .send(format!("PRIVMSG #{channel} :{message}"))
        .map_err(|_| "Chat is not connected".to_string())
}

#[tauri::command]
fn twitch_chat_stop(state: tauri::State<'_, ChatIrc>) {
    if let Ok(mut sender) = state.sender.lock() {
        *sender = None;
    }
}

fn shutdown(app: &tauri::AppHandle) {
    for window in app.webview_windows().into_values() {
        let _ = window.destroy();
    }
    app.exit(0);
}

#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    shutdown(&app);
}

fn show_main_window(app: &tauri::AppHandle, page: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if let Some(page) = page {
        let _ = app.emit("tray-navigate", page);
    }
}

static MAIN_WINDOW_REVEALED: AtomicBool = AtomicBool::new(false);

fn reveal_main_window(app: &tauri::AppHandle) {
    MAIN_WINDOW_REVEALED.store(true, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Called by the frontend once the boot splash is painted, so the window never
/// flashes an empty surface before the logo is visible.
#[tauri::command]
fn reveal_window(app: tauri::AppHandle) {
    reveal_main_window(&app);
}

#[tauri::command]
fn tray_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("tray") {
        let _ = window.hide();
    }
    match action.as_str() {
        "open" => show_main_window(&app, None),
        "dashboard" | "stream" | "chat" | "activity" | "settings" => {
            show_main_window(&app, Some(&action));
        }
        "reconnect" => {
            let _ = app.emit("tray-reconnect", ());
        }
        "quit" => shutdown(&app),
        _ => return Err("Unknown tray action".into()),
    }
    Ok(())
}

#[tauri::command]
fn tray_set_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "Tray icon is unavailable".to_string())?;
    tray.set_tooltip(Some(tooltip))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn tray_configure(
    app: tauri::AppHandle,
    state: tauri::State<'_, TrayState>,
    config: TrayMenuConfig,
) -> Result<(), String> {
    let use_custom = config.mode != "classic" && app.get_webview_window("tray").is_some();
    state.custom.store(use_custom, Ordering::Relaxed);

    let status = MenuItemBuilder::with_id("tray-status", config.status)
        .enabled(false)
        .build(&app)
        .map_err(|error| error.to_string())?;
    let menu = MenuBuilder::new(&app)
        .item(&status)
        .separator()
        .text("open", config.open)
        .text("dashboard", config.dashboard)
        .text("stream", config.stream)
        .text("chat", config.chat)
        .text("activity", config.activity)
        .separator()
        .text("reconnect", config.reconnect)
        .text("settings", config.settings)
        .separator()
        .text("quit", config.quit)
        .build()
        .map_err(|error| error.to_string())?;
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "Tray icon is unavailable".to_string())?;
    if use_custom {
        tray.set_menu(None::<tauri::menu::Menu<tauri::Wry>>)
            .map_err(|error| error.to_string())?;
    } else {
        tray.set_menu(Some(menu))
            .map_err(|error| error.to_string())?;
    }
    tray.set_show_menu_on_left_click(false)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn distribution_channel() -> &'static str {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::ERROR_INSUFFICIENT_BUFFER,
            Storage::Packaging::Appx::GetCurrentPackageFullName,
        };

        let mut length = 0;
        let result = unsafe { GetCurrentPackageFullName(&mut length, None) };
        if result == ERROR_INSUFFICIENT_BUFFER {
            return "store";
        }
    }

    "standalone"
}

#[tauri::command]
async fn store_update_available() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows::Services::Store::StoreContext;

        if distribution_channel() != "store" {
            return Err("Microsoft Store updates require an installed Store package".into());
        }
        let context = StoreContext::GetDefault().map_err(|error| error.to_string())?;
        let updates = context
            .GetAppAndOptionalStorePackageUpdatesAsync()
            .map_err(|error| error.to_string())?
            .await
            .map_err(|error| error.to_string())?;
        return updates
            .Size()
            .map(|count| count > 0)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(windows))]
    Err("Microsoft Store updates are only available on Windows".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ChatIrc::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let db_path = app.path().app_data_dir()?.join("streamdash.db");
            if let Some(data_directory) = db_path.parent() {
                migrate_legacy_data(data_directory).map_err(std::io::Error::other)?;
            }
            let db = init_database(db_path).map_err(std::io::Error::other)?;
            let custom_tray = db
                .query_row(
                    "SELECT value FROM settings WHERE key = 'trayStyle'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
                .map(|value| serde_json::from_str::<String>(&value).unwrap_or(value) != "classic")
                .unwrap_or(true);
            app.manage(AppState { db: Mutex::new(db) });
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let tray_window =
                WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("index.html?tray=1".into()))
                    .inner_size(336.0, 224.0)
                    .resizable(false)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(true)
                    .transparent(true)
                    .focused(false)
                    .visible(false)
                    .build()
                    .ok();
            let custom_tray = custom_tray && tray_window.is_some();
            if let Some(tray_window) = tray_window {
                let tray_window_on_blur = tray_window.clone();
                tray_window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Focused(false)) {
                        let _ = tray_window_on_blur.hide();
                    }
                });
            }
            app.manage(TrayState {
                custom: AtomicBool::new(custom_tray),
            });
            let tray_icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| std::io::Error::other("StreamDash application icon is missing"))?;
            let tray_status =
                MenuItemBuilder::with_id("tray-status", "Offline · Twitch: Disconnected")
                    .enabled(false)
                    .build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&tray_status)
                .separator()
                .text("open", "Open StreamDash")
                .text("dashboard", "Dashboard")
                .text("stream", "Stream")
                .text("chat", "Chat")
                .text("activity", "Activity")
                .separator()
                .text("reconnect", "Reconnect services")
                .text("settings", "Settings")
                .separator()
                .text("quit", "Quit StreamDash")
                .build()?;
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .tooltip("StreamDash")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let _ = tray_action(app.clone(), event.id().as_ref().to_string());
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        position,
                        button,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if button == tauri::tray::MouseButton::Left {
                            show_main_window(tray.app_handle(), None);
                            return;
                        }
                        let state = tray.app_handle().state::<TrayState>();
                        if button != tauri::tray::MouseButton::Right
                            || !state.custom.load(Ordering::Relaxed)
                        {
                            return;
                        }
                        if let Some(window) = tray.app_handle().get_webview_window("tray") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                                return;
                            }
                            if let Ok(size) = window.outer_size() {
                                let x = (position.x.round() as i32 - size.width as i32 + 16).max(0);
                                let y =
                                    (position.y.round() as i32 - size.height as i32 - 12).max(0);
                                let _ = window.set_position(PhysicalPosition::new(x, y));
                            }
                            if window.show().is_ok() {
                                let _ = window.set_focus();
                                let _ = tray.app_handle().emit("tray-opened", ());
                                return;
                            }
                        }
                        show_main_window(tray.app_handle(), None);
                    }
                });
            if !custom_tray {
                tray_builder = tray_builder.menu(&tray_menu);
            }
            tray_builder.build(app)?;
            // Safety net: if the frontend never reports in (e.g. a broken
            // bundle), still show the window instead of staying invisible.
            let fallback = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2500));
                if !MAIN_WINDOW_REVEALED.load(Ordering::Relaxed) {
                    reveal_main_window(&fallback);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            events_list,
            event_insert,
            events_clear,
            settings_load,
            setting_save,
            secret_set,
            secret_get,
            secret_delete,
            twitch_device_start,
            twitch_device_poll,
            twitch_session,
            twitch_helix_get,
            twitch_helix_patch,
            twitch_helix_post,
            twitch_helix_put,
            twitch_helix_delete,
            twitch_eventsub_create,
            twitch_chat_start,
            twitch_chat_send,
            twitch_chat_stop,
            distribution_channel,
            store_update_available,
            app_quit,
            reveal_window,
            tray_action,
            tray_configure,
            tray_set_tooltip
        ])
        .build(tauri::generate_context!())
        .expect("error while building StreamDash")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                for window in app.webview_windows().into_values() {
                    let _ = window.destroy();
                }
            }
        });
}
