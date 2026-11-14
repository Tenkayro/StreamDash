use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
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

mod spotify_overlay;
mod web_host;

static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn http() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};

fn app_display_name() -> &'static str {
    "StreamDash"
}

fn credential_service() -> &'static str {
    if cfg!(debug_assertions) {
        "StreamDash.dev"
    } else {
        app_display_name()
    }
}

fn preferences_registry_key() -> &'static str {
    if cfg!(debug_assertions) {
        r"HKCU\Software\Tenkayro\StreamDashDev"
    } else {
        r"HKCU\Software\Tenkayro\StreamDash"
    }
}

struct AppState {
    db: Mutex<Connection>,
    history: Mutex<Connection>,
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
#[serde(rename_all = "camelCase")]
struct ChatRecord {
    id: String,
    login: String,
    display_name: String,
    color: String,
    badges: Value,
    timestamp: i64,
    text: String,
    parts: Value,
    #[serde(default)]
    first_message: bool,
    #[serde(default)]
    action: bool,
    reply: Option<Value>,
    #[serde(default)]
    deleted: bool,
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
    keyring::Entry::new(credential_service(), name).map_err(|e| e.to_string())
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
            preferences_registry_key(),
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
        "twitch-bot-oauth",
        "streamelements-token",
        "tipeeestream-api-key",
        "obs-password",
    ] {
        delete_secret_value(secret)?;
    }

    let data_name = "StreamDash";
    let identifier = "dev.streamdash.desktop";
    let autostart_names = &["StreamDash", "streamdash"];
    if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
        remove_directory_if_present(roaming.join(data_name))?;
        remove_directory_if_present(roaming.join(identifier))?;
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        remove_directory_if_present(local.join(data_name))?;
        remove_directory_if_present(local.join(identifier))?;
    }

    for value in autostart_names {
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
        .args(["delete", preferences_registry_key(), "/f"])
        .status();
    Ok(())
}

fn twitch_secret_name(bot: bool) -> &'static str {
    if bot {
        "twitch-bot-oauth"
    } else {
        "twitch-oauth"
    }
}

fn load_twitch_tokens_for(bot: bool) -> Result<TwitchTokens, String> {
    let raw = load_secret(twitch_secret_name(bot))?.ok_or("Twitch is not connected")?;
    serde_json::from_str(&raw).map_err(|_| "Stored Twitch credentials are invalid".to_string())
}

fn store_twitch_tokens_for(bot: bool, tokens: &TwitchTokens) -> Result<(), String> {
    save_secret(
        twitch_secret_name(bot),
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
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS activity_events (
           id TEXT PRIMARY KEY, source TEXT NOT NULL, event_type TEXT NOT NULL,
           username TEXT, display_name TEXT, timestamp TEXT NOT NULL,
           amount REAL, currency TEXT, message TEXT, tier TEXT,
           gift_count INTEGER, bits INTEGER, viewer_count INTEGER,
           metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_events(timestamp DESC);
         CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_events(event_type);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn init_history_database(path: PathBuf) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;
         PRAGMA foreign_keys=ON;
         PRAGMA temp_store=MEMORY;
         CREATE TABLE IF NOT EXISTS activity_events (
           id TEXT PRIMARY KEY, source TEXT NOT NULL, event_type TEXT NOT NULL,
           username TEXT, display_name TEXT, timestamp TEXT NOT NULL,
           amount REAL, currency TEXT, message TEXT, tier TEXT,
           gift_count INTEGER, bits INTEGER, viewer_count INTEGER,
           metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_events(timestamp DESC);
         CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_events(event_type);
         CREATE INDEX IF NOT EXISTS idx_activity_source ON activity_events(source);
         CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_events(username);
         CREATE TABLE IF NOT EXISTS chat_messages (
           id TEXT PRIMARY KEY, login TEXT NOT NULL, display_name TEXT NOT NULL,
           color TEXT NOT NULL DEFAULT '', badges TEXT NOT NULL DEFAULT '[]',
           timestamp INTEGER NOT NULL, text TEXT NOT NULL, parts TEXT NOT NULL DEFAULT '[]',
           first_message INTEGER NOT NULL DEFAULT 0, action INTEGER NOT NULL DEFAULT 0,
           reply TEXT, deleted INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_messages(timestamp DESC);
         CREATE INDEX IF NOT EXISTS idx_chat_login ON chat_messages(login);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn migrate_legacy_activity(db: &Connection, history: &Connection) -> Result<(), String> {
    let count: i64 = history
        .query_row("SELECT COUNT(*) FROM activity_events", [], |row| row.get(0))
        .unwrap_or(0);
    if count > 0 {
        return Ok(());
    }
    let mut stmt = match db.prepare("SELECT id,source,event_type,username,display_name,timestamp,amount,currency,message,tier,gift_count,bits,viewer_count,metadata FROM activity_events") {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    let rows = match stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<f64>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<i64>>(10)?,
            row.get::<_, Option<i64>>(11)?,
            row.get::<_, Option<i64>>(12)?,
            row.get::<_, String>(13)?,
        ))
    }) {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    let tx = history.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut insert = tx.prepare("INSERT OR IGNORE INTO activity_events (id,source,event_type,username,display_name,timestamp,amount,currency,message,tier,gift_count,bits,viewer_count,metadata,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)").map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let _ = insert.execute(params![row.0,row.1,row.2,row.3,row.4,row.5,row.6,row.7,row.8,row.9,row.10,row.11,row.12,row.13,now_epoch()]);
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn events_list(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<ActivityRecord>, String> {
    let conn = state.history.lock().map_err(|_| "Database lock failed")?;
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
    let conn = state.history.lock().map_err(|_| "Database lock failed")?;
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
fn history_merge_events(
    state: tauri::State<'_, AppState>,
    events: Vec<ActivityRecord>,
    max_events: Option<u32>,
) -> Result<usize, String> {
    if events.is_empty() {
        return Ok(0);
    }
    let mut conn = state.history.lock().map_err(|_| "Database lock failed")?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = now_epoch();
    let mut inserted = 0usize;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO activity_events
             (id,source,event_type,username,display_name,timestamp,amount,currency,message,tier,gift_count,bits,viewer_count,metadata,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        ).map_err(|e| e.to_string())?;
        for event in &events {
            let changed = stmt.execute(params![
                event.id,
                event.source,
                event.event_type,
                event.username,
                event.display_name,
                event.timestamp,
                event.amount,
                event.currency,
                event.message,
                event.tier,
                event.gift_count,
                event.bits,
                event.viewer_count,
                event.metadata.to_string(),
                now
            ]).map_err(|e| e.to_string())?;
            inserted += changed;
        }
    }
    let keep = max_events.unwrap_or(50_000).clamp(100, 50_000);
    tx.execute(
        "DELETE FROM activity_events WHERE id IN (SELECT id FROM activity_events ORDER BY timestamp DESC LIMIT -1 OFFSET ?1)",
        [keep],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

#[tauri::command]
fn events_clear(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .history
        .lock()
        .map_err(|_| "Database lock failed")?
        .execute("DELETE FROM activity_events", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn chat_messages_list(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<ChatRecord>, String> {
    let conn = state.history.lock().map_err(|_| "Database lock failed")?;
    let mut stmt = conn.prepare(
        "SELECT id,login,display_name,color,badges,timestamp,text,parts,first_message,action,reply,deleted
         FROM chat_messages ORDER BY timestamp DESC LIMIT ?1",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit.unwrap_or(1000).min(50_000)], |row| {
            let badges: String = row.get(4)?;
            let parts: String = row.get(7)?;
            let reply: Option<String> = row.get(10)?;
            Ok(ChatRecord {
                id: row.get(0)?,
                login: row.get(1)?,
                display_name: row.get(2)?,
                color: row.get(3)?,
                badges: serde_json::from_str(&badges).unwrap_or(json!([])),
                timestamp: row.get(5)?,
                text: row.get(6)?,
                parts: serde_json::from_str(&parts).unwrap_or(json!([])),
                first_message: row.get::<_, i64>(8)? != 0,
                action: row.get::<_, i64>(9)? != 0,
                reply: reply.and_then(|r| serde_json::from_str(&r).ok()),
                deleted: row.get::<_, i64>(11)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut items: Vec<_> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    items.reverse();
    Ok(items)
}

#[tauri::command]
fn chat_message_insert(
    state: tauri::State<'_, AppState>,
    message: ChatRecord,
    max_messages: u32,
) -> Result<bool, String> {
    let conn = state.history.lock().map_err(|_| "Database lock failed")?;
    if !message.id.starts_with("local-") {
        let _ = conn.execute(
            "DELETE FROM chat_messages WHERE id LIKE 'local-%' AND login = ?1 AND text = ?2 AND ABS(timestamp - ?3) < 15000",
            params![message.login, message.text, message.timestamp],
        );
    }
    let changed = conn.execute(
        "INSERT OR IGNORE INTO chat_messages (id,login,display_name,color,badges,timestamp,text,parts,first_message,action,reply,deleted)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            message.id, message.login, message.display_name, message.color,
            message.badges.to_string(), message.timestamp, message.text, message.parts.to_string(),
            if message.first_message { 1 } else { 0 }, if message.action { 1 } else { 0 },
            message.reply.map(|r| r.to_string()), if message.deleted { 1 } else { 0 },
        ],
    ).map_err(|e| e.to_string())?;
    let keep = max_messages.clamp(100, 50_000);
    conn.execute("DELETE FROM chat_messages WHERE id IN (SELECT id FROM chat_messages ORDER BY timestamp DESC LIMIT -1 OFFSET ?1)", [keep])
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

#[tauri::command]
fn chat_message_update(
    state: tauri::State<'_, AppState>,
    id: Option<String>,
    login: Option<String>,
    deleted: bool,
) -> Result<(), String> {
    let conn = state.history.lock().map_err(|_| "Database lock failed")?;
    if let Some(id) = id {
        conn.execute("UPDATE chat_messages SET deleted=?2 WHERE id=?1", params![id, if deleted { 1 } else { 0 }])
            .map_err(|e| e.to_string())?;
    } else if let Some(login) = login {
        conn.execute("UPDATE chat_messages SET deleted=?2 WHERE login=?1", params![login, if deleted { 1 } else { 0 }])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE chat_messages SET deleted=?1", params![if deleted { 1 } else { 0 }])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn chat_messages_clear(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.history.lock().map_err(|_| "Database lock failed")?.execute("DELETE FROM chat_messages", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn history_import(
    state: tauri::State<'_, AppState>,
    events: Vec<ActivityRecord>,
    chat_messages: Vec<ChatRecord>,
    max_events: u32,
    max_chat_messages: u32,
) -> Result<(), String> {
    let conn = state.history.lock().map_err(|_| "Database lock failed")?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut insert_event = tx
            .prepare(
                "INSERT OR IGNORE INTO activity_events
                 (id,source,event_type,username,display_name,timestamp,amount,currency,message,tier,gift_count,bits,viewer_count,metadata,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            )
            .map_err(|e| e.to_string())?;
        let now = now_epoch();
        for event in events {
            insert_event
                .execute(params![
                    event.id,
                    event.source,
                    event.event_type,
                    event.username,
                    event.display_name,
                    event.timestamp,
                    event.amount,
                    event.currency,
                    event.message,
                    event.tier,
                    event.gift_count,
                    event.bits,
                    event.viewer_count,
                    event.metadata.to_string(),
                    now,
                ])
                .map_err(|e| e.to_string())?;
        }

        let mut insert_chat = tx
            .prepare(
                "INSERT OR IGNORE INTO chat_messages
                 (id,login,display_name,color,badges,timestamp,text,parts,first_message,action,reply,deleted)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            )
            .map_err(|e| e.to_string())?;
        for message in chat_messages {
            insert_chat
                .execute(params![
                    message.id,
                    message.login,
                    message.display_name,
                    message.color,
                    message.badges.to_string(),
                    message.timestamp,
                    message.text,
                    message.parts.to_string(),
                    if message.first_message { 1 } else { 0 },
                    if message.action { 1 } else { 0 },
                    message.reply.map(|r| r.to_string()),
                    if message.deleted { 1 } else { 0 },
                ])
                .map_err(|e| e.to_string())?;
        }
    }
    let keep_events = max_events.clamp(100, 50_000);
    tx.execute(
        "DELETE FROM activity_events WHERE id IN (SELECT id FROM activity_events ORDER BY timestamp DESC LIMIT -1 OFFSET ?1)",
        [keep_events],
    )
    .map_err(|e| e.to_string())?;
    let keep_chat = max_chat_messages.clamp(100, 50_000);
    tx.execute(
        "DELETE FROM chat_messages WHERE id IN (SELECT id FROM chat_messages ORDER BY timestamp DESC LIMIT -1 OFFSET ?1)",
        [keep_chat],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
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
fn settings_save_batch(
    state: tauri::State<'_, AppState>,
    entries: HashMap<String, Value>,
) -> Result<(), String> {
    let keep_pref = entries.get("keepUserData").and_then(Value::as_bool);
    let conn = state.db.lock().map_err(|_| "Database lock failed")?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .map_err(|e| e.to_string())?;
        for (key, value) in entries {
            stmt.execute(params![key, value.to_string()])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    if let Some(keep) = keep_pref {
        set_keep_user_data_preference(keep)?;
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
            | "twitch-bot-oauth"
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
    bot: Option<bool>,
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
        store_twitch_tokens_for(bot.unwrap_or(false), &tokens)?;
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

async fn refresh_twitch_for(
    client_id: &str,
    current: TwitchTokens,
    bot: bool,
) -> Result<TwitchTokens, String> {
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
    store_twitch_tokens_for(bot, &updated)?;
    Ok(updated)
}

async fn valid_tokens_for(client_id: &str, bot: bool) -> Result<TwitchTokens, String> {
    let tokens = load_twitch_tokens_for(bot)?;
    if tokens.expires_at <= now_epoch() + 120 {
        refresh_twitch_for(client_id, tokens, bot).await
    } else {
        Ok(tokens)
    }
}

async fn valid_tokens(client_id: &str) -> Result<TwitchTokens, String> {
    valid_tokens_for(client_id, false).await
}

#[tauri::command]
async fn twitch_session(
    client_id: String,
    bot: Option<bool>,
) -> Result<Option<TwitchSession>, String> {
    let is_bot = bot.unwrap_or(false);
    let tokens = match load_twitch_tokens_for(is_bot) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let tokens = if tokens.expires_at <= now_epoch() + 120 {
        refresh_twitch_for(&client_id, tokens, is_bot).await?
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
        delete_secret_value(twitch_secret_name(is_bot))?;
        return Ok(None);
    }
    let value: Value = response.json().await.map_err(|e| e.to_string())?;
    if value["client_id"].as_str() != Some(client_id.as_str()) {
        delete_secret_value(twitch_secret_name(is_bot))?;
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

fn validate_helix_path(path: &str) -> Result<&str, String> {
    if path.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Invalid Helix path".into());
    }
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty()
        || trimmed.contains("..")
        || trimmed.contains("://")
        || trimmed.contains('\\')
        || trimmed.contains('?')
        || trimmed.contains('#')
    {
        return Err("Invalid Helix path".into());
    }
    Ok(trimmed)
}

async fn helix_request(
    method: reqwest::Method,
    client_id: &str,
    path: &str,
    query: &[(String, String)],
    body: Option<&Value>,
    use_bot: bool,
    allow_empty_error_json: bool,
) -> Result<Value, String> {
    let clean_path = validate_helix_path(path)?;
    let tokens = valid_tokens_for(client_id, use_bot).await?;
    let url = format!("https://api.twitch.tv/helix/{clean_path}");
    let mut request = http()
        .request(method, url)
        .query(query)
        .header("Client-Id", client_id)
        .bearer_auth(tokens.access_token);
    if let Some(json_body) = body {
        request = request.json(json_body);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(json!({}));
    }
    let body: Value = if allow_empty_error_json {
        response.json().await.unwrap_or(json!({}))
    } else {
        response.json().await.map_err(|e| e.to_string())?
    };
    if !status.is_success() {
        return Err(body["message"]
            .as_str()
            .unwrap_or("Twitch API request failed")
            .to_string());
    }
    Ok(body)
}

#[tauri::command]
async fn twitch_helix_get(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    helix_request(reqwest::Method::GET, &client_id, &path, &query, None, false, false).await
}

#[tauri::command]
async fn twitch_helix_patch(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
) -> Result<Value, String> {
    helix_request(
        reqwest::Method::PATCH,
        &client_id,
        &path,
        &query,
        Some(&body),
        false,
        false,
    )
    .await
}

#[tauri::command]
async fn twitch_helix_post(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
    bot: Option<bool>,
) -> Result<Value, String> {
    helix_request(
        reqwest::Method::POST,
        &client_id,
        &path,
        &query,
        Some(&body),
        bot.unwrap_or(false),
        false,
    )
    .await
}

#[tauri::command]
async fn twitch_helix_put(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
    body: Value,
) -> Result<Value, String> {
    helix_request(
        reqwest::Method::PUT,
        &client_id,
        &path,
        &query,
        Some(&body),
        false,
        false,
    )
    .await
}

#[tauri::command]
async fn twitch_helix_delete(
    client_id: String,
    path: String,
    query: Vec<(String, String)>,
) -> Result<Value, String> {
    helix_request(
        reqwest::Method::DELETE,
        &client_id,
        &path,
        &query,
        None,
        false,
        true,
    )
    .await
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

const CLOUD_SYNC_BASE_URL: &str = "https://streamdash-api.tenkayro.de";

const APP_SIGNING_MASK: [u8; 32] = [
    207, 97, 88, 223, 48, 41, 149, 52, 54, 93, 130, 183, 114, 34, 104, 132, 142, 250, 253, 188, 38,
    230, 146, 33, 182, 165, 120, 217, 213, 251, 222, 25,
];
const APP_SIGNING_ENC: [u8; 32] = [
    219, 225, 18, 12, 224, 144, 173, 156, 177, 252, 16, 141, 106, 27, 199, 16, 16, 206, 198, 224,
    131, 73, 98, 147, 115, 157, 117, 74, 83, 141, 157, 164,
];

fn sign_cloud_request(
    method: &reqwest::Method,
    path: &str,
    body_bytes: &[u8],
) -> Result<(String, String, String), String> {
    use ring::{
        digest, hmac,
        rand::{SecureRandom, SystemRandom},
    };

    let mut key_bytes = [0u8; 32];
    for i in 0..32 {
        key_bytes[i] = APP_SIGNING_MASK[i] ^ APP_SIGNING_ENC[i];
    }
    let hmac_key = hmac::Key::new(hmac::HMAC_SHA256, &key_bytes);
    key_bytes.fill(0);

    let mut nonce_bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| "Failed to generate request nonce".to_string())?;
    let nonce = hex::encode(nonce_bytes);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();

    let body_sha256 = hex::encode(digest::digest(&digest::SHA256, body_bytes).as_ref());
    let canonical_path = path.split('?').next().unwrap_or(path);
    let canonical = format!(
        "{}\n{}\n{}\n{}\n{}",
        method.as_str(),
        canonical_path,
        timestamp,
        nonce,
        body_sha256
    );
    let sig = hex::encode(hmac::sign(&hmac_key, canonical.as_bytes()).as_ref());
    Ok((timestamp, nonce, sig))
}

async fn cloud_sync_send(
    client_id: &str,
    method: reqwest::Method,
    path: &str,
    payload: Option<&Value>,
) -> Result<(u16, Value), String> {
    let mut tokens = valid_tokens(client_id).await?;
    let url = format!("{CLOUD_SYNC_BASE_URL}{path}");
    let body_bytes = match payload {
        Some(body) => serde_json::to_vec(body).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };

    for attempt in 0..2 {
        let (ts, nonce, sig) = sign_cloud_request(&method, path, &body_bytes)?;
        let mut req = http()
            .request(method.clone(), &url)
            .bearer_auth(&tokens.access_token)
            .header("X-SD-Timestamp", &ts)
            .header("X-SD-Nonce", &nonce)
            .header("X-SD-Signature", &sig)
            .timeout(std::time::Duration::from_secs(30));
        if payload.is_some() {
            req = req
                .header("Content-Type", "application/json")
                .body(body_bytes.clone());
        }
        let response = req.send().await.map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());
        if status == 401 && attempt == 0 {
            tokens = refresh_twitch_for(client_id, tokens, false).await?;
            continue;
        }
        let mut value: Value = response.json().await.unwrap_or(json!({}));
        if status == 429 {
            if let (Some(secs), Some(obj)) = (retry_after, value.as_object_mut()) {
                obj.insert("retryAfter".into(), json!(secs));
            }
        }
        return Ok((status, value));
    }

    Err("Cloud sync authentication failed".into())
}

fn cloud_sync_error(status: u16, body: &Value) -> String {
    if status == 429 {
        if let Some(secs) = body.get("retryAfter").and_then(|v| v.as_u64()) {
            return format!("rate_limited:{secs}");
        }
        return "rate_limited".to_string();
    }
    body["error"]
        .as_str()
        .or_else(|| body["message"].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Cloud sync error ({status})"))
}

#[tauri::command]
async fn cloud_sync_meta(client_id: String) -> Result<Value, String> {
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::GET,
        "/v1/profile/meta",
        None,
    )
    .await?;
    if status == 402 {
        return Ok(json!({ "exists": false, "proRequired": true }));
    }
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn cloud_sync_pull(client_id: String) -> Result<Value, String> {
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::GET,
        "/v1/profile",
        None,
    )
    .await?;
    if status == 402 {
        return Ok(json!({ "exists": false, "proRequired": true }));
    }
    if status == 404 {
        return Ok(json!({ "exists": false }));
    }
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn cloud_sync_push(
    client_id: String,
    bundle: Value,
    updated_at: Option<i64>,
    expected_revision: Option<i64>,
    force: Option<bool>,
) -> Result<Value, String> {
    let mut payload = serde_json::Map::new();
    payload.insert("bundle".into(), bundle);
    if let Some(ts) = updated_at {
        payload.insert("updatedAt".into(), json!(ts));
    }
    if let Some(rev) = expected_revision {
        payload.insert("expectedRevision".into(), json!(rev));
    }
    if force.unwrap_or(false) {
        payload.insert("force".into(), json!(true));
    }
    let body_value = Value::Object(payload);
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::PUT,
        "/v1/profile",
        Some(&body_value),
    )
    .await?;
    if status == 402 {
        return Ok(json!({ "ok": false, "proRequired": true }));
    }
    if status == 409 {
        return Ok(json!({
            "ok": false,
            "conflict": true,
            "meta": body.get("meta").cloned().unwrap_or(Value::Null),
            "bundle": body.get("bundle").cloned().unwrap_or(Value::Null),
        }));
    }
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn cloud_sync_delete(client_id: String) -> Result<Value, String> {
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::DELETE,
        "/v1/profile",
        None,
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn pro_entitlements(client_id: String) -> Result<Value, String> {
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::GET,
        "/v1/entitlements",
        None,
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn pro_activate_license(client_id: String, license_key: String) -> Result<Value, String> {
    let payload = json!({ "licenseKey": license_key });
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::POST,
        "/v1/pro/activate",
        Some(&payload),
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn support_ticket_status(client_id: String) -> Result<Value, String> {
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::GET,
        "/v1/support/ticket",
        None,
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn support_submit_key_reset(client_id: String, message: String) -> Result<Value, String> {
    let payload = json!({ "message": message });
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::POST,
        "/v1/support/key-reset",
        Some(&payload),
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn history_sync_meta(client_id: String) -> Result<Value, String> {
    let (status, body) =
        cloud_sync_send(&client_id, reqwest::Method::GET, "/v1/history/meta", None).await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn history_sync_pull(client_id: String) -> Result<Value, String> {
    let (status, body) =
        cloud_sync_send(&client_id, reqwest::Method::GET, "/v1/history", None).await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn history_sync_push(
    client_id: String,
    payload: Value,
    expected_revision: Option<i64>,
) -> Result<Value, String> {
    let body_req = json!({
        "payload": payload,
        "expectedRevision": expected_revision,
    });
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::PUT,
        "/v1/history",
        Some(&body_req),
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn support_storage_status(client_id: String) -> Result<Value, String> {
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::GET,
        "/v1/support/storage-status",
        None,
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[tauri::command]
async fn support_storage_request(
    client_id: String,
    requested_mb: u32,
    message: String,
) -> Result<Value, String> {
    let payload = json!({
        "requestedMb": requested_mb,
        "message": message,
    });
    let (status, body) = cloud_sync_send(
        &client_id,
        reqwest::Method::POST,
        "/v1/support/storage-request",
        Some(&payload),
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(cloud_sync_error(status, &body));
    }
    Ok(body)
}

#[derive(Default)]
struct ChatIrc {
    sender: Mutex<Option<mpsc::UnboundedSender<String>>>,
}

fn validate_irc_identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.contains(['\r', '\n', ' ', '#', ':'])
        || value.chars().any(char::is_control)
    {
        return Err("Invalid chat identifier".into());
    }
    Ok(())
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
    validate_irc_identifier(&login)?;
    validate_irc_identifier(&channel)?;
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
    reply_parent_id: Option<String>,
) -> Result<(), String> {
    validate_irc_identifier(&channel)?;
    if message.contains(['\r', '\n']) {
        return Err("Invalid chat message".into());
    }
    if reply_parent_id.as_ref().is_some_and(|id| {
        id.is_empty() || !id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
    }) {
        return Err("Invalid reply message ID".into());
    }
    let sender = state
        .sender
        .lock()
        .map_err(|_| "Chat state is unavailable")?;
    let sender = sender.as_ref().ok_or("Chat is not connected")?;
    let line = reply_parent_id
        .map(|id| format!("@reply-parent-msg-id={id} PRIVMSG #{channel} :{message}"))
        .unwrap_or_else(|| format!("PRIVMSG #{channel} :{message}"));
    sender
        .send(line)
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

static SHUTDOWN_STARTED: AtomicBool = AtomicBool::new(false);

fn request_shutdown(app: &tauri::AppHandle) {
    if SHUTDOWN_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("tray") {
        let _ = window.hide();
    }
    let _ = app.emit("app-shutdown-requested", ());
    let fallback = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if SHUTDOWN_STARTED.load(Ordering::SeqCst) {
            shutdown(&fallback);
        }
    });
}

#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    request_shutdown(&app);
}

#[tauri::command]
fn app_shutdown_ready(app: tauri::AppHandle) {
    show_main_window(&app, None);
}

#[tauri::command]
fn app_quit_complete(app: tauri::AppHandle) {
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
    if web_host::is_headless() {
        return;
    }
    reveal_main_window(&app);
}

#[tauri::command]
fn web_host_status(host: tauri::State<'_, web_host::WebHostRuntime>) -> web_host::WebHostStatus {
    host.status()
}

#[tauri::command]
fn web_host_configure(
    state: tauri::State<'_, AppState>,
    host: tauri::State<'_, web_host::WebHostRuntime>,
    enabled: bool,
    port: u16,
    require_auth: bool,
    token: Option<String>,
) -> Result<web_host::WebHostStatus, String> {
    let status = host.configure(enabled, port, require_auth, token)?;
    if let Ok(conn) = state.db.lock() {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params!["webHostEnabled", serde_json::to_string(&status.enabled).unwrap_or_default()],
        );
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params!["webHostPort", serde_json::to_string(&status.port).unwrap_or_default()],
        );
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params!["webHostRequireAuth", serde_json::to_string(&status.require_auth).unwrap_or_default()],
        );
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params!["webHostToken", serde_json::to_string(&status.token).unwrap_or_default()],
        );
    }
    Ok(status)
}

#[tauri::command]
fn web_host_regenerate_token(
    state: tauri::State<'_, AppState>,
    host: tauri::State<'_, web_host::WebHostRuntime>,
) -> web_host::WebHostStatus {
    let next = host.regenerate_token();
    if let Ok(conn) = state.db.lock() {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params!["webHostToken", serde_json::to_string(&next).unwrap_or_default()],
        );
    }
    host.status()
}

#[tauri::command]
fn web_host_publish_state(host: tauri::State<'_, web_host::WebHostRuntime>, snapshot: Value) {
    host.publish_state(snapshot);
}

#[tauri::command]
fn web_host_publish_companion_event(host: tauri::State<'_, web_host::WebHostRuntime>, event: Value) {
    host.publish_companion_event(event);
}

#[tauri::command]
fn web_host_pair_pending(
    host: tauri::State<'_, web_host::WebHostRuntime>,
) -> Vec<web_host::PendingPairRequestView> {
    host.pending_pair_requests()
}

#[tauri::command]
fn web_host_pair_respond(
    host: tauri::State<'_, web_host::WebHostRuntime>,
    request_id: String,
    approve: bool,
) -> bool {
    host.respond_pair_request(&request_id, approve)
}

#[tauri::command]
async fn open_devtools_window(app: tauri::AppHandle) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("DevTools are only available in dev builds".into());
    }
    if let Some(window) = app.get_webview_window("devtools") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        "devtools",
        WebviewUrl::App("index.html?devtools=1".into()),
    )
    .title("StreamDash DevTools")
    .inner_size(560.0, 760.0)
    .min_inner_size(440.0, 560.0)
    .resizable(true)
    .decorations(true)
    .focused(true)
    .build()
    .map_err(|err| format!("Failed to open DevTools window: {err}"))?;
    Ok(())
}

#[tauri::command]
fn tray_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("tray") {
        let _ = window.hide();
    }
    match action.as_str() {
        "open" => show_main_window(&app, None),
        "dashboard" | "stream" | "chat" | "activitys" | "activity" | "donations" | "settings" => {
            let page = if action == "activity" || action == "donations" { "activitys" } else { &action };
            show_main_window(&app, Some(page));
        }
        "reconnect" => {
            let _ = app.emit("tray-reconnect", ());
        }
        "quit" => request_shutdown(&app),
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
        .text("activitys", config.activity)
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
fn runtime_platform() -> &'static str {
    std::env::consts::OS
}

#[cfg(target_os = "linux")]
const LINUX_INSTALL_SCRIPT_URL: &str =
    "https://raw.githubusercontent.com/Tenkayro/StreamDash/main/install.sh";

#[tauri::command]
async fn linux_script_update() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        use std::process::{Command, Stdio};
        use std::time::Duration;

        let client = reqwest::Client::builder()
            .user_agent("streamdash-updater")
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .get(LINUX_INSTALL_SCRIPT_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to download Linux updater script: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Linux updater script request failed with HTTP {}",
                resp.status()
            ));
        }
        let script = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read Linux updater script: {e}"))?;
        if !script.trim_start().starts_with("#!/") {
            return Err("Downloaded Linux updater script has unexpected content".into());
        }

        let script_path = std::env::temp_dir().join(format!(
            "streamdash-update-{}.sh",
            std::process::id()
        ));
        std::fs::write(&script_path, script.as_bytes())
            .map_err(|e| format!("Could not write temporary updater script: {e}"))?;
        let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o700));

        let active_appimage = std::env::var_os("APPIMAGE")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from);
        let active_exe = std::env::current_exe().ok().map(|p| {
            let raw = p.to_string_lossy();
            if let Some(stripped) = raw.strip_suffix(" (deleted)") {
                PathBuf::from(stripped)
            } else {
                p
            }
        });

        let script_path_for_run = script_path.clone();
        let output = tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new("bash");
            cmd.arg(&script_path_for_run)
                .arg("--update")
                .arg("--yes")
                .env("NO_COLOR", "1")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if let Some(appimage) = active_appimage {
                cmd.env("STREAMDASH_ACTIVE_APPIMAGE", appimage);
            } else if let Some(exe) = active_exe {
                cmd.env("STREAMDASH_ACTIVE_EXE", exe);
            }
            cmd.output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Failed to launch bash updater: {e}"))?;

        let _ = std::fs::remove_file(&script_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = stderr
                .lines()
                .chain(stdout.lines())
                .rev()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .unwrap_or("Updater script exited with an error")
                .to_string();
            return Err(detail);
        }
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    Err("Linux script update is only supported on Linux".into())
}

#[tauri::command]
fn app_relaunch(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let target = std::env::var_os("APPIMAGE")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .filter(|p| p.exists())
            .or_else(|| {
                std::env::current_exe().ok().map(|p| {
                    let raw = p.to_string_lossy();
                    if let Some(stripped) = raw.strip_suffix(" (deleted)") {
                        PathBuf::from(stripped)
                    } else {
                        p
                    }
                })
            })
            .ok_or_else(|| "Could not determine StreamDash executable path".to_string())?;

        Command::new(&target)
            .args(std::env::args_os().skip(1))
            .spawn()
            .map_err(|e| format!("Failed to relaunch {}: {e}", target.display()))?;
        app.exit(0);
        #[allow(unreachable_code)]
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        app.restart();
    }
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

fn dev_data_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .unwrap_or(manifest_dir.as_path())
        .join(".dev-data")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if cfg!(debug_assertions) {
        let dev_root = std::env::var_os("STREAMDASH_DATA_DIR")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(dev_data_root);
        let webview_dir = dev_root.join("webview");
        let _ = std::fs::create_dir_all(&webview_dir);
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            // SAFETY: Executed at the very start of `run()` before Tauri/WebView2 spawns worker threads.
            unsafe {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);
            }
        }
    }
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
            let custom_data_dir = std::env::var_os("STREAMDASH_DATA_DIR")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .or_else(|| {
                    if cfg!(debug_assertions) {
                        Some(dev_data_root())
                    } else {
                        None
                    }
                });
            let is_temp_profile = custom_data_dir.is_some();
            let data_directory = match custom_data_dir {
                Some(dir) => {
                    std::fs::create_dir_all(&dir)?;
                    dir
                }
                None => app.path().app_data_dir()?,
            };
            let db_path = data_directory.join("streamdash.db");
            let history_path = data_directory.join("history.db");
            if !is_temp_profile {
                migrate_legacy_data(&data_directory).map_err(std::io::Error::other)?;
            }
            let db = init_database(db_path).map_err(std::io::Error::other)?;
            let history = init_history_database(history_path).map_err(std::io::Error::other)?;
            let _ = migrate_legacy_activity(&db, &history);
            let custom_tray = db
                .query_row(
                    "SELECT value FROM settings WHERE key = 'trayStyle'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
                .map(|value| serde_json::from_str::<String>(&value).unwrap_or(value) != "classic")
                .unwrap_or(true);
            let cli_host = web_host::parse_cli_args();
            let read_setting_str = |key: &str| -> Option<String> {
                db.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                    row.get::<_, String>(0)
                })
                .ok()
                .and_then(|raw| serde_json::from_str::<String>(&raw).ok().or(Some(raw)))
            };
            let host_enabled = cli_host.enable_host
                || db
                    .query_row(
                        "SELECT value FROM settings WHERE key = 'webHostEnabled'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                    .and_then(|v| serde_json::from_str::<bool>(&v).ok())
                    .unwrap_or(false);
            let host_port = cli_host.port.unwrap_or_else(|| {
                db.query_row(
                    "SELECT value FROM settings WHERE key = 'webHostPort'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
                .and_then(|v| serde_json::from_str::<u16>(&v).ok())
                .unwrap_or(web_host::DEFAULT_HOST_PORT)
            });
            let host_require_auth = db
                .query_row(
                    "SELECT value FROM settings WHERE key = 'webHostRequireAuth'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
                .and_then(|v| serde_json::from_str::<bool>(&v).ok())
                .unwrap_or(true);
            let host_token = cli_host
                .token
                .or_else(|| read_setting_str("webHostToken").filter(|s| !s.trim().is_empty()))
                .unwrap_or_else(|| {
                    let generated = web_host::generate_token();
                    let _ = db.execute(
                        "INSERT OR REPLACE INTO settings (key, value) VALUES ('webHostToken', ?1)",
                        [serde_json::to_string(&generated).unwrap_or_default()],
                    );
                    generated
                });
            let web_host_runtime = web_host::WebHostRuntime::new(
                app.handle().clone(),
                host_enabled,
                host_port,
                host_require_auth,
                host_token,
            );
            app.manage(web_host_runtime);
            app.manage(AppState { db: Mutex::new(db), history: Mutex::new(history) });
            let spotify_overlay =
                spotify_overlay::start(17_842).map_err(std::io::Error::other)?;
            app.manage(spotify_overlay);
            if cfg!(debug_assertions) {
                let log_dir = data_directory.join("logs");
                let _ = std::fs::create_dir_all(&log_dir);
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Folder {
                                path: log_dir,
                                file_name: None,
                            },
                        ))
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
                .text("open", format!("Open {}", app_display_name()))
                .text("dashboard", "Dashboard")
                .text("stream", "Stream")
                .text("chat", "Chat")
                .text("activitys", "Activitys")
                .separator()
                .text("reconnect", "Reconnect services")
                .text("settings", "Settings")
                .separator()
                .text("quit", format!("Quit {}", app_display_name()))
                .build()?;
            let mut tray_builder = TrayIconBuilder::with_id("main")
                .icon(tray_icon)
                .tooltip(app_display_name())
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
            chat_messages_list,
            chat_message_insert,
            chat_message_update,
            chat_messages_clear,
            history_import,
            settings_load,
            setting_save,
            settings_save_batch,
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
            cloud_sync_meta,
            cloud_sync_pull,
            cloud_sync_push,
            cloud_sync_delete,
            history_sync_meta,
            history_sync_pull,
            history_sync_push,
            history_merge_events,
            pro_entitlements,
            pro_activate_license,
            support_ticket_status,
            support_submit_key_reset,
            support_storage_status,
            support_storage_request,
            twitch_chat_start,
            twitch_chat_send,
            twitch_chat_stop,
            runtime_platform,
            linux_script_update,
            app_relaunch,
            distribution_channel,
            store_update_available,
            app_quit,
            app_shutdown_ready,
            app_quit_complete,
            reveal_window,
            web_host_status,
            web_host_configure,
            web_host_regenerate_token,
            web_host_publish_state,
            web_host_publish_companion_event,
            web_host_pair_pending,
            web_host_pair_respond,
            tray_action,
            tray_configure,
            tray_set_tooltip,
            open_devtools_window,
            spotify_overlay::spotify_overlay_info,
            spotify_overlay::spotify_overlay_status
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helix_path_validation_allows_clean_paths_and_blocks_traversal() {
        assert_eq!(validate_helix_path("/users").unwrap(), "users");
        assert_eq!(
            validate_helix_path("channel_points/custom_rewards").unwrap(),
            "channel_points/custom_rewards"
        );
        assert!(validate_helix_path("").is_err());
        assert!(validate_helix_path("../secret").is_err());
        assert!(validate_helix_path("https://evil.test/users").is_err());
        assert!(validate_helix_path("users?login=foo").is_err());
        assert!(validate_helix_path("users\r\n").is_err());
    }

    #[test]
    fn irc_identifier_validation_blocks_crlf_and_spaces() {
        assert!(validate_irc_identifier("tenkayro").is_ok());
        assert!(validate_irc_identifier("").is_err());
        assert!(validate_irc_identifier("foo\r\nPART #bar").is_err());
        assert!(validate_irc_identifier("#channel").is_err());
        assert!(validate_irc_identifier("two words").is_err());
    }

    #[test]
    fn databases_initialize_schemas_and_wal_mode() {
        let base = std::env::temp_dir().join(format!("streamdash-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let db = init_database(base.join("streamdash.db")).expect("settings db should init");
        let history =
            init_history_database(base.join("history.db")).expect("history db should init");

        let mode: String = db
            .query_row("PRAGMA journal_mode;", [], |r| r.get(0))
            .expect("journal mode");
        assert_eq!(mode.to_lowercase(), "wal");

        let tables: i64 = history
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('activity_events', 'chat_messages');",
                [],
                |r| r.get(0),
            )
            .expect("tables count");
        assert_eq!(tables, 2);

        drop(db);
        drop(history);
        let _ = std::fs::remove_dir_all(&base);
    }
}
