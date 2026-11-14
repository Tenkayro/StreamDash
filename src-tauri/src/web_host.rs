use std::{
    collections::HashMap,
    convert::Infallible,
    net::{IpAddr, SocketAddr, UdpSocket},
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicUsize, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    extract::{Query, State as AxumState},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Json, Redirect, Response,
    },
    routing::{get, post},
    Router,
};
use futures_util::stream;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, watch};

pub const DEFAULT_HOST_PORT: u16 = 48_950;
pub const DISCOVERY_PORT: u16 = 48_951;
pub const DISCOVERY_MAGIC: &[u8] = b"STREAMDASH_DISCOVER_V1";
const PAIR_REQUEST_TTL: Duration = Duration::from_secs(60);
const MAX_PENDING_PAIR_REQUESTS: usize = 8;

static HEADLESS_MODE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Default)]
pub struct CliHostOverrides {
    pub headless: bool,
    pub enable_host: bool,
    pub port: Option<u16>,
    pub token: Option<String>,
}

pub fn parse_cli_args() -> CliHostOverrides {
    let mut out = CliHostOverrides::default();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--headless" => {
                out.headless = true;
                out.enable_host = true;
            }
            "--host" | "--web-host" => {
                out.enable_host = true;
            }
            "--port" | "--host-port" => {
                if let Some(val) = args.next()
                    && let Ok(port) = val.parse::<u16>()
                    && port >= 1024
                {
                    out.port = Some(port);
                }
            }
            "--pin" | "--token" => {
                if let Some(val) = args.next() {
                    let trimmed = val.trim().to_string();
                    if !trimmed.is_empty() {
                        out.token = Some(trimmed);
                    }
                }
            }
            _ => {
                if let Some(rest) = arg.strip_prefix("--port=").or_else(|| arg.strip_prefix("--host-port="))
                    && let Ok(port) = rest.parse::<u16>()
                    && port >= 1024
                {
                    out.port = Some(port);
                } else if let Some(rest) = arg.strip_prefix("--pin=").or_else(|| arg.strip_prefix("--token=")) {
                    let trimmed = rest.trim().to_string();
                    if !trimmed.is_empty() {
                        out.token = Some(trimmed);
                    }
                }
            }
        }
    }
    HEADLESS_MODE.store(out.headless, Ordering::Relaxed);
    out
}

pub fn is_headless() -> bool {
    HEADLESS_MODE.load(Ordering::Relaxed)
}

pub fn generate_token() -> String {
    let rng = SystemRandom::new();
    let mut bytes = [0u8; 4];
    if rng.fill(&mut bytes).is_ok() {
        hex::encode_upper(bytes)
    } else {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
            ^ std::process::id();
        format!("{nanos:08X}")
    }
}

fn sanitize_token(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control() && !c.is_whitespace() && !matches!(c, ';' | '"' | '\\'))
        .collect()
}

fn tokens_match(provided: &str, expected: &str) -> bool {
    let clean = provided.trim().as_bytes();
    let expected_bytes = expected.as_bytes();
    if clean.is_empty() || expected_bytes.is_empty() || clean.len() != expected_bytes.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in clean.iter().zip(expected_bytes.iter()) {
        diff |= a ^ b;
    }
    std::hint::black_box(diff) == 0
}

fn has_unsafe_path_segments(path: &str) -> bool {
    path.contains('\\')
        || path.contains('\0')
        || path.chars().any(char::is_control)
        || path.split('/').any(|seg| seg == "..")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebHostStatus {
    pub enabled: bool,
    pub running: bool,
    pub headless: bool,
    pub port: u16,
    pub require_auth: bool,
    pub token: String,
    pub local_ips: Vec<String>,
    pub urls: Vec<String>,
    pub connected_clients: usize,
    pub last_error: Option<String>,
}

struct ClientGuard {
    counter: Arc<AtomicUsize>,
}

impl Drop for ClientGuard {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PairDecision {
    Pending,
    Approved,
    Denied,
}

#[derive(Debug, Clone)]
struct PairRequestRecord {
    request_id: String,
    verify_code: String,
    device_name: String,
    decision: PairDecision,
    created_at: Instant,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairRequestView {
    pub request_id: String,
    pub verify_code: String,
    pub device_name: String,
    pub expires_in_sec: u64,
}

#[derive(Clone)]
struct AxumHostState {
    app: AppHandle,
    require_auth: Arc<AtomicBool>,
    token: Arc<RwLock<String>>,
    snapshot_json: Arc<RwLock<String>>,
    tx: broadcast::Sender<String>,
    companion_tx: broadcast::Sender<String>,
    shutdown_rx: watch::Receiver<bool>,
    connected_clients: Arc<AtomicUsize>,
    pair_requests: Arc<Mutex<HashMap<String, PairRequestRecord>>>,
}

pub struct WebHostRuntime {
    app: AppHandle,
    enabled: AtomicBool,
    running: Arc<AtomicBool>,
    port: AtomicU16,
    require_auth: Arc<AtomicBool>,
    token: Arc<RwLock<String>>,
    snapshot_json: Arc<RwLock<String>>,
    last_companion_json: Arc<Mutex<String>>,
    tx: broadcast::Sender<String>,
    companion_tx: broadcast::Sender<String>,
    connected_clients: Arc<AtomicUsize>,
    pair_requests: Arc<Mutex<HashMap<String, PairRequestRecord>>>,
    last_error: Arc<RwLock<Option<String>>>,
    stop_tx: Mutex<Option<watch::Sender<bool>>>,
    server_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    discovery_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl WebHostRuntime {
    pub fn new(
        app: AppHandle,
        enabled: bool,
        port: u16,
        require_auth: bool,
        token: String,
    ) -> Self {
        let (tx, _) = broadcast::channel::<String>(32);
        let (companion_tx, _) = broadcast::channel::<String>(64);
        let runtime = Self {
            app,
            enabled: AtomicBool::new(enabled),
            running: Arc::new(AtomicBool::new(false)),
            port: AtomicU16::new(if port >= 1024 { port } else { DEFAULT_HOST_PORT }),
            require_auth: Arc::new(AtomicBool::new(require_auth)),
            token: Arc::new(RwLock::new({
                let cleaned = sanitize_token(&token);
                if cleaned.is_empty() {
                    generate_token()
                } else {
                    cleaned
                }
            })),
            snapshot_json: Arc::new(RwLock::new("{}".to_string())),
            last_companion_json: Arc::new(Mutex::new(String::new())),
            tx,
            companion_tx,
            connected_clients: Arc::new(AtomicUsize::new(0)),
            pair_requests: Arc::new(Mutex::new(HashMap::new())),
            last_error: Arc::new(RwLock::new(None)),
            stop_tx: Mutex::new(None),
            server_task: Mutex::new(None),
            discovery_task: Mutex::new(None),
        };
        if enabled {
            let _ = runtime.restart_server();
        }
        runtime
    }

    pub fn status(&self) -> WebHostStatus {
        let port = self.port.load(Ordering::Relaxed);
        let token = self
            .token
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let require_auth = self.require_auth.load(Ordering::Relaxed);
        let local_ips = detect_local_ips();
        let urls = local_ips
            .iter()
            .map(|ip| {
                if require_auth && !token.is_empty() {
                    format!("http://{ip}:{port}/?token={token}")
                } else {
                    format!("http://{ip}:{port}/")
                }
            })
            .collect();
        WebHostStatus {
            enabled: self.enabled.load(Ordering::Relaxed),
            running: self.running.load(Ordering::Relaxed),
            headless: is_headless(),
            port,
            require_auth,
            token,
            local_ips,
            urls,
            connected_clients: self.connected_clients.load(Ordering::Relaxed),
            last_error: self
                .last_error
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
        }
    }

    pub fn configure(
        &self,
        enabled: bool,
        port: u16,
        require_auth: bool,
        token: Option<String>,
    ) -> Result<WebHostStatus, String> {
        let safe_port = if port >= 1024 { port } else { DEFAULT_HOST_PORT };
        let prev_enabled = self.enabled.load(Ordering::Relaxed);
        let prev_port = self.port.load(Ordering::Relaxed);

        self.enabled.store(enabled, Ordering::Relaxed);
        self.port.store(safe_port, Ordering::Relaxed);
        self.require_auth.store(require_auth, Ordering::Relaxed);

        if let Some(t) = token {
            let trimmed = sanitize_token(&t);
            if !trimmed.is_empty() {
                *self.token.write().unwrap_or_else(|e| e.into_inner()) = trimmed;
            }
        }

        if !enabled {
            self.stop_server(false);
            *self.last_error.write().unwrap_or_else(|e| e.into_inner()) = None;
        } else if !prev_enabled || prev_port != safe_port || !self.running.load(Ordering::Relaxed) {
            self.restart_server()?;
        }

        Ok(self.status())
    }

    pub fn regenerate_token(&self) -> String {
        let next = generate_token();
        *self.token.write().unwrap_or_else(|e| e.into_inner()) = next.clone();
        next
    }

    pub fn publish_state(&self, snapshot: Value) {
        if let Some(companion_val) = snapshot
            .get("settings")
            .and_then(|s| s.get("companion"))
            && let Ok(companion_str) = serde_json::to_string(companion_val)
        {
            let mut guard = self
                .last_companion_json
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if *guard != companion_str {
                *guard = companion_str;
                let event_payload = json!({
                    "kind": "settings",
                    "companion": companion_val,
                });
                if let Ok(evt_str) = serde_json::to_string(&event_payload) {
                    let _ = self.companion_tx.send(evt_str);
                }
            }
        }
        if let Ok(json_str) = serde_json::to_string(&snapshot) {
            *self
                .snapshot_json
                .write()
                .unwrap_or_else(|e| e.into_inner()) = json_str.clone();
            let _ = self.tx.send(json_str);
        }
    }

    pub fn publish_companion_event(&self, event: Value) {
        if let Ok(json_str) = serde_json::to_string(&event) {
            let _ = self.companion_tx.send(json_str);
        }
    }

    pub fn pending_pair_requests(&self) -> Vec<PendingPairRequestView> {
        let mut guard = self.pair_requests.lock().unwrap_or_else(|e| e.into_inner());
        prune_expired_pair_requests(&mut guard);
        let mut list: Vec<PendingPairRequestView> = guard
            .values()
            .filter(|rec| rec.decision == PairDecision::Pending)
            .map(pair_record_to_view)
            .collect();
        list.sort_by_key(|v| std::cmp::Reverse(v.expires_in_sec));
        list
    }

    pub fn respond_pair_request(&self, request_id: &str, approve: bool) -> bool {
        let mut guard = self.pair_requests.lock().unwrap_or_else(|e| e.into_inner());
        prune_expired_pair_requests(&mut guard);
        let Some(entry) = guard.get_mut(request_id) else {
            let _ = self
                .app
                .emit("web-host-pair-resolved", json!({ "requestId": request_id }));
            return false;
        };
        if entry.decision != PairDecision::Pending {
            return false;
        }
        entry.decision = if approve {
            PairDecision::Approved
        } else {
            PairDecision::Denied
        };
        let _ = self
            .app
            .emit("web-host-pair-resolved", json!({ "requestId": request_id }));
        true
    }

    fn stop_server(&self, immediate_abort: bool) {
        if let Ok(mut guard) = self.pair_requests.lock() {
            guard.clear();
        }
        if let Ok(mut guard) = self.stop_tx.lock()
            && let Some(tx) = guard.take()
        {
            let _ = tx.send(true);
        }
        if let Ok(mut guard) = self.server_task.lock()
            && let Some(handle) = guard.take()
        {
            if immediate_abort {
                handle.abort();
            } else {
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    handle.abort();
                });
            }
        }
        if let Ok(mut guard) = self.discovery_task.lock()
            && let Some(handle) = guard.take()
        {
            handle.abort();
        }
        self.running.store(false, Ordering::Relaxed);
    }

    fn restart_server(&self) -> Result<(), String> {
        self.stop_server(false);
        let port = self.port.load(Ordering::Relaxed);
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        let listener = {
            let mut attempt = 0;
            loop {
                match std::net::TcpListener::bind(addr) {
                    Ok(l) => break l,
                    Err(e) if e.kind() == std::io::ErrorKind::AddrInUse && attempt < 10 => {
                        attempt += 1;
                        std::thread::sleep(Duration::from_millis(40));
                    }
                    Err(e) => {
                        let msg = format!("Port {port}: {e}");
                        *self.last_error.write().unwrap_or_else(|e| e.into_inner()) =
                            Some(msg.clone());
                        return Err(msg);
                    }
                }
            }
        };
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;

        *self.last_error.write().unwrap_or_else(|e| e.into_inner()) = None;
        self.running.store(true, Ordering::Relaxed);

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        if let Ok(mut guard) = self.stop_tx.lock() {
            *guard = Some(shutdown_tx);
        }

        let shared = AxumHostState {
            app: self.app.clone(),
            require_auth: self.require_auth.clone(),
            token: self.token.clone(),
            snapshot_json: self.snapshot_json.clone(),
            tx: self.tx.clone(),
            companion_tx: self.companion_tx.clone(),
            shutdown_rx: shutdown_rx.clone(),
            connected_clients: self.connected_clients.clone(),
            pair_requests: self.pair_requests.clone(),
        };

        let router = Router::new()
            .route("/api/health", get(api_health))
            .route("/api/pair/request", post(api_pair_request))
            .route("/api/pair/status", get(api_pair_status))
            .route("/api/pair/cancel", post(api_pair_cancel))
            .route("/api/host-status", get(api_host_status))
            .route("/api/state", get(api_state))
            .route("/api/events", get(api_events))
            .route("/api/companion-settings", get(api_companion_settings))
            .route("/api/companion-events", get(api_companion_events))
            .route("/api/action", post(api_action))
            .route("/api/dev-apk-info", get(api_dev_apk_info))
            .route("/api/dev-apk", get(api_dev_apk))
            .fallback(get(serve_app_asset))
            .with_state(shared);

        let running_flag = self.running.clone();
        let err_slot = self.last_error.clone();

        let handle = tauri::async_runtime::spawn(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(l) => l,
                Err(e) => {
                    *err_slot.write().unwrap_or_else(|er| er.into_inner()) = Some(e.to_string());
                    running_flag.store(false, Ordering::Relaxed);
                    return;
                }
            };
            let mut shutdown_wait = shutdown_rx;
            let shutdown_signal = async move {
                while !*shutdown_wait.borrow() {
                    if shutdown_wait.changed().await.is_err() {
                        break;
                    }
                }
            };
            if let Err(e) = axum::serve(listener, router)
                .with_graceful_shutdown(shutdown_signal)
                .await
            {
                log::error!("Web host server stopped: {e}");
                *err_slot.write().unwrap_or_else(|er| er.into_inner()) = Some(e.to_string());
            }
            running_flag.store(false, Ordering::Relaxed);
        });

        if let Ok(mut guard) = self.server_task.lock() {
            *guard = Some(handle);
        }

        let disc_running = self.running.clone();
        let disc_auth = self.require_auth.clone();
        let disc_handle = tauri::async_runtime::spawn(async move {
            let mut bound_sock = None;
            for _ in 0..8 {
                if !disc_running.load(Ordering::Relaxed) {
                    return;
                }
                match tokio::net::UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).await {
                    Ok(s) => {
                        let _ = s.set_broadcast(true);
                        bound_sock = Some(s);
                        break;
                    }
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                }
            }
            let Some(sock) = bound_sock else {
                return;
            };
            let mut buf = [0u8; 256];
            while disc_running.load(Ordering::Relaxed) {
                let Ok((len, peer)) = sock.recv_from(&mut buf).await else {
                    break;
                };
                if !buf[..len].starts_with(DISCOVERY_MAGIC) {
                    continue;
                }
                let reply = build_discovery_payload(port, disc_auth.load(Ordering::Relaxed));
                if let Ok(bytes) = serde_json::to_vec(&reply) {
                    let _ = sock.send_to(&bytes, peer).await;
                }
            }
        });
        if let Ok(mut guard) = self.discovery_task.lock() {
            *guard = Some(disc_handle);
        }

        Ok(())
    }
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

fn is_authorized(state: &AxumHostState, headers: &HeaderMap, query_token: Option<&str>) -> bool {
    if !state.require_auth.load(Ordering::Relaxed) {
        return true;
    }
    let expected = state.token.read().unwrap_or_else(|e| e.into_inner()).clone();
    if expected.is_empty() {
        return true;
    }
    if let Some(q) = query_token
        && tokens_match(q, &expected)
    {
        return true;
    }
    if let Some(hdr) = headers.get("x-sd-token").and_then(|v| v.to_str().ok())
        && tokens_match(hdr, &expected)
    {
        return true;
    }
    if let Some(auth) = headers.get("authorization").and_then(|v| v.to_str().ok())
        && let Some(bearer) = auth.strip_prefix("Bearer ")
        && tokens_match(bearer, &expected)
    {
        return true;
    }
    if let Some(cookie_hdr) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        for part in cookie_hdr.split(';') {
            if let Some((k, v)) = part.trim().split_once('=')
                && k.trim() == "sd_host_token"
                && tokens_match(v, &expected)
            {
                return true;
            }
        }
    }
    false
}

fn access_denied_html(wrong_token: bool) -> String {
    let banner = if wrong_token {
        r#"<div class="err">Zugriff verweigert: Der eingegebene Zugriffstoken ist ungültig.<br><small>Access denied: Invalid access token.</small></div>"#
    } else {
        r#"<div class="info">Zugriff geschützt: Bitte gültigen Zugriffstoken eingeben oder QR-Code in StreamDash scannen.<br><small>Access protected: Enter a valid access token or scan the QR code in StreamDash.</small></div>"#
    };
    format!(
        r#"<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>StreamDash · Zugriff verweigert</title>
  <style>
    body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:#0b0c0f; color:#f4f4f5; font-family:system-ui,-apple-system,sans-serif; padding:20px; }}
    .card {{ width:100%; max-width:400px; background:#14161c; border:1px solid rgba(255,255,255,.1); border-radius:16px; padding:24px; box-sizing:border-box; }}
    h1 {{ margin:0 0 8px 0; font-size:18px; }}
    .err {{ margin:12px 0; padding:10px 12px; border-radius:10px; background:rgba(239,68,68,.14); border:1px solid rgba(248,113,113,.35); color:#fecaca; font-size:13px; }}
    .info {{ margin:12px 0; padding:10px 12px; border-radius:10px; background:rgba(139,92,246,.14); border:1px solid rgba(139,92,246,.35); color:#ddd6fe; font-size:13px; }}
    input {{ width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:#0b0c0f; color:#fff; font-family:monospace; font-size:14px; margin-bottom:10px; }}
    button {{ width:100%; padding:10px 14px; border-radius:10px; border:none; background:#8b5cf6; color:#fff; font-weight:600; font-size:14px; cursor:pointer; }}
  </style>
</head>
<body>
  <div class="card">
    <h1>StreamDash Remote</h1>
    {banner}
    <form method="GET" action="/">
      <input type="password" name="token" placeholder="Zugriffstoken / Access Token" autocomplete="off" autofocus required />
      <button type="submit">Verbinden / Connect</button>
    </form>
  </div>
</body>
</html>"#
    )
}

async fn serve_app_asset(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    uri: Uri,
) -> Response {
    if state.require_auth.load(Ordering::Relaxed) {
        let expected = state.token.read().unwrap_or_else(|e| e.into_inner()).clone();
        if !expected.is_empty() {
            if let Some(ref q_tok) = query.token {
                if tokens_match(q_tok, &expected) {
                    let cookie_val = sanitize_token(&expected);
                    let cookie = format!(
                        "sd_host_token={cookie_val}; Path=/; HttpOnly; SameSite=Lax"
                    );
                    let mut resp = Redirect::to("/").into_response();
                    if let Ok(val) = cookie.parse() {
                        resp.headers_mut().insert(header::SET_COOKIE, val);
                    }
                    return resp;
                }
                return (StatusCode::UNAUTHORIZED, Html(access_denied_html(true))).into_response();
            }
            if !is_authorized(&state, &headers, None) {
                return (StatusCode::UNAUTHORIZED, Html(access_denied_html(false))).into_response();
            }
        }
    }
    let raw_path = uri.path().trim_start_matches('/');
    if has_unsafe_path_segments(raw_path) {
        return (StatusCode::BAD_REQUEST, "Invalid path").into_response();
    }
    let rel_path = if raw_path.is_empty() { "index.html" } else { raw_path };
    // In `tauri dev`, always prefer the live Vite dev server so we never serve a stale `dist/`.
    if cfg!(debug_assertions) {
        static VITE_BASE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        let base = VITE_BASE.get_or_init(|| {
            // Prefer IPv4 loopback strictly before any IPv6 fallback to avoid Windows IPv6 stall
            if let Ok(addr) = "127.0.0.1:1420".parse()
                && std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok()
            {
                return "http://127.0.0.1:1420".to_string();
            }
            if let Ok(addr) = "[::1]:1420".parse()
                && std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok()
            {
                return "http://[::1]:1420".to_string();
            }
            "http://127.0.0.1:1420".to_string()
        });
        let dev_url = format!(
            "{base}/{}{}",
            raw_path,
            uri.query().map(|q| format!("?{q}")).unwrap_or_default()
        );
        if let Ok(resp) = crate::http().get(&dev_url).send().await {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let content_type = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            if let Ok(bytes) = resp.bytes().await {
                return Response::builder()
                    .status(status)
                    .header(header::CONTENT_TYPE, content_type)
                    .body(Body::from(bytes))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
            }
        }
    }

    let resolver = state.app.asset_resolver();
    let asset = resolver.get(rel_path.to_string()).or_else(|| {
        if !rel_path.contains('.') {
            resolver.get("index.html".to_string())
        } else {
            None
        }
    });

    if let Some(asset) = asset {
        let cache_control = if rel_path.starts_with("assets/") {
            "public, max-age=31536000, immutable"
        } else {
            "no-store"
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, asset.mime_type)
            .header(header::CACHE_CONTROL, cache_control)
            .body(Body::from(asset.bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}

async fn api_health(AxumState(state): AxumState<AxumHostState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "service": "streamdash-host",
        "authRequired": state.require_auth.load(Ordering::Relaxed),
        "hostName": detect_host_name(),
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

fn generate_pair_id() -> String {
    let rng = SystemRandom::new();
    let mut bytes = [0u8; 16];
    if rng.fill(&mut bytes).is_ok() {
        hex::encode(bytes)
    } else {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{nanos:032x}")
    }
}

fn generate_verify_code() -> String {
    let rng = SystemRandom::new();
    let mut digits = [0u8; 6];
    let mut buf = [0u8; 16];
    let mut filled = 0;
    while filled < 6 {
        if rng.fill(&mut buf).is_err() {
            let fallback = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(135_791);
            let num = 100_000 + (fallback % 900_000);
            let s = format!("{num:06}");
            return format!("{} {}", &s[..3], &s[3..]);
        }
        for &b in &buf {
            if b < 250 && filled < 6 {
                digits[filled] = b'0' + (b % 10);
                filled += 1;
            }
        }
    }
    let s = String::from_utf8_lossy(&digits).into_owned();
    format!("{} {}", &s[..3], &s[3..])
}

fn sanitize_device_name(raw: Option<&str>) -> String {
    let cleaned: String = raw
        .unwrap_or("")
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(48)
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Android Companion".to_string()
    } else {
        trimmed.to_string()
    }
}

fn prune_expired_pair_requests(map: &mut HashMap<String, PairRequestRecord>) {
    let now = Instant::now();
    map.retain(|_, rec| now.duration_since(rec.created_at) < PAIR_REQUEST_TTL);
}

fn pair_record_to_view(rec: &PairRequestRecord) -> PendingPairRequestView {
    let elapsed = Instant::now().saturating_duration_since(rec.created_at);
    let remaining = PAIR_REQUEST_TTL.saturating_sub(elapsed).as_secs().max(1);
    PendingPairRequestView {
        request_id: rec.request_id.clone(),
        verify_code: rec.verify_code.clone(),
        device_name: rec.device_name.clone(),
        expires_in_sec: remaining,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequestBody {
    device_name: Option<String>,
}

#[derive(Deserialize)]
struct PairStatusQuery {
    id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairCancelBody {
    request_id: Option<String>,
}

async fn api_pair_request(
    AxumState(state): AxumState<AxumHostState>,
    Json(body): Json<PairRequestBody>,
) -> impl IntoResponse {
    let device_name = sanitize_device_name(body.device_name.as_deref());
    let request_id = generate_pair_id();
    let verify_code = generate_verify_code();
    let record = PairRequestRecord {
        request_id: request_id.clone(),
        verify_code: verify_code.clone(),
        device_name,
        decision: PairDecision::Pending,
        created_at: Instant::now(),
    };
    let view = pair_record_to_view(&record);

    {
        let mut guard = state.pair_requests.lock().unwrap_or_else(|e| e.into_inner());
        prune_expired_pair_requests(&mut guard);
        if guard.len() >= MAX_PENDING_PAIR_REQUESTS {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": "too_many_requests" })),
            )
                .into_response();
        }
        guard.insert(request_id.clone(), record);
    }

    let _ = state.app.emit("web-host-pair-request", &view);
    Json(json!({
        "requestId": request_id,
        "verifyCode": verify_code,
        "hostName": detect_host_name(),
        "expiresInSec": PAIR_REQUEST_TTL.as_secs(),
    }))
    .into_response()
}

async fn api_pair_status(
    AxumState(state): AxumState<AxumHostState>,
    Query(query): Query<PairStatusQuery>,
) -> impl IntoResponse {
    let Some(request_id) = query.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "status": "expired" }))).into_response();
    };
    let mut guard = state.pair_requests.lock().unwrap_or_else(|e| e.into_inner());
    prune_expired_pair_requests(&mut guard);
    let Some(decision) = guard.get(request_id).map(|rec| rec.decision) else {
        return Json(json!({ "status": "expired" })).into_response();
    };
    match decision {
        PairDecision::Pending => {
            let code = guard
                .get(request_id)
                .map(|r| r.verify_code.clone())
                .unwrap_or_default();
            Json(json!({ "status": "pending", "verifyCode": code })).into_response()
        }
        PairDecision::Denied => {
            guard.remove(request_id);
            Json(json!({ "status": "denied" })).into_response()
        }
        PairDecision::Approved => {
            guard.remove(request_id);
            let token = if state.require_auth.load(Ordering::Relaxed) {
                state.token.read().unwrap_or_else(|e| e.into_inner()).clone()
            } else {
                String::new()
            };
            Json(json!({
                "status": "approved",
                "token": token,
                "hostName": detect_host_name(),
            }))
            .into_response()
        }
    }
}

async fn api_pair_cancel(
    AxumState(state): AxumState<AxumHostState>,
    Json(body): Json<PairCancelBody>,
) -> impl IntoResponse {
    let Some(request_id) = body
        .request_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return Json(json!({ "ok": true })).into_response();
    };
    let removed = {
        let mut guard = state.pair_requests.lock().unwrap_or_else(|e| e.into_inner());
        guard.remove(request_id).is_some()
    };
    if removed {
        let _ = state
            .app
            .emit("web-host-pair-resolved", json!({ "requestId": request_id }));
    }
    Json(json!({ "ok": true })).into_response()
}

async fn api_host_status(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    }
    let status = state.app.state::<WebHostRuntime>().status();
    Json(status).into_response()
}

async fn api_state(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    }
    let raw = state
        .snapshot_json
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let payload = if raw.trim_start().starts_with('{') {
        raw
    } else {
        "{}".to_string()
    };
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        payload,
    )
        .into_response()
}

fn resolve_dev_apk_path() -> Option<std::path::PathBuf> {
    if let Ok(explicit) = std::env::var("STREAMDASH_DEV_APK") {
        let p = std::path::PathBuf::from(explicit.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    if !cfg!(debug_assertions) {
        return None;
    }
    let rel_dirs = [
        "android-companion/app/build/outputs/apk/release",
        "android-companion/app/build/outputs/apk/debug",
    ];
    let mut bases = vec![std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")];
    if let Ok(cwd) = std::env::current_dir() {
        bases.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            bases.push(parent.to_path_buf());
        }
    }
    let mut best: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
    for base in bases {
        for rel in rel_dirs {
            let dir = base.join(rel);
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let candidate = entry.path();
                if candidate.is_file()
                    && candidate.extension().and_then(|e| e.to_str()) == Some("apk")
                {
                    let mtime = candidate
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::UNIX_EPOCH);
                    if best.as_ref().is_none_or(|(best_time, _)| mtime > *best_time) {
                        best = Some((mtime, candidate));
                    }
                }
            }
        }
    }
    best.map(|(_, path)| path)
}

async fn api_dev_apk_info(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(path) = resolve_dev_apk_path() else {
        return axum::Json(serde_json::json!({ "available": false })).into_response();
    };
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => return axum::Json(serde_json::json!({ "available": false })).into_response(),
    };
    let digest = ring::digest::digest(&ring::digest::SHA256, &bytes);
    let sha256 = hex::encode(digest.as_ref());
    axum::Json(serde_json::json!({
        "available": true,
        "sha256": sha256,
        "size": bytes.len(),
    }))
    .into_response()
}

async fn api_dev_apk(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(path) = resolve_dev_apk_path() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| n.ends_with(".apk"))
        .unwrap_or("StreamDash-Android.apk");
    let disposition = format!("attachment; filename=\"{}\"", filename);
    (
        [
            (header::CONTENT_TYPE, "application/vnd.android.package-archive".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        bytes,
    )
        .into_response()
}

async fn api_events(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    state.connected_clients.fetch_add(1, Ordering::Relaxed);
    let guard = Arc::new(ClientGuard {
        counter: state.connected_clients.clone(),
    });

    let initial = state
        .snapshot_json
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let rx = state.tx.subscribe();
    let shutdown_rx = state.shutdown_rx.clone();

    let stream = stream::unfold(
        (rx, Some(initial), shutdown_rx, false, guard),
        |(mut rx, mut initial, mut shutdown_rx, done, guard)| async move {
            if done {
                return None;
            }
            if *shutdown_rx.borrow() {
                return Some((
                    Ok::<Event, Infallible>(
                        Event::default()
                            .event("host_stopped")
                            .data("{\"reason\":\"disabled\"}"),
                    ),
                    (rx, None, shutdown_rx, true, guard),
                ));
            }
            if let Some(first) = initial.take() {
                return Some((
                    Ok::<Event, Infallible>(Event::default().event("state").data(first)),
                    (rx, None, shutdown_rx, false, guard),
                ));
            }
            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        let _ = changed;
                        return Some((
                            Ok::<Event, Infallible>(
                                Event::default()
                                    .event("host_stopped")
                                    .data("{\"reason\":\"disabled\"}"),
                            ),
                            (rx, None, shutdown_rx, true, guard),
                        ));
                    }
                    res = rx.recv() => {
                        match res {
                            Ok(msg) => {
                                return Some((
                                    Ok(Event::default().event("state").data(msg)),
                                    (rx, None, shutdown_rx, false, guard),
                                ));
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(broadcast::error::RecvError::Closed) => return None,
                        }
                    }
                }
            }
        },
    );

    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping"))
        .into_response()
}

fn extract_companion_from_snapshot(raw: &str) -> Value {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|v| v.get("settings").and_then(|s| s.get("companion")).cloned())
        .unwrap_or(Value::Null)
}

async fn api_companion_settings(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    }
    let raw = state
        .snapshot_json
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let companion = extract_companion_from_snapshot(&raw);
    Json(json!({ "companion": companion })).into_response()
}

async fn api_companion_events(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let raw = state
        .snapshot_json
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let initial_companion = extract_companion_from_snapshot(&raw);
    let initial = if initial_companion.is_object() {
        serde_json::to_string(&json!({
            "kind": "settings",
            "companion": initial_companion,
        }))
        .ok()
    } else {
        None
    };

    let rx = state.companion_tx.subscribe();
    let shutdown_rx = state.shutdown_rx.clone();
    let stream = stream::unfold(
        (rx, initial, shutdown_rx, false),
        |(mut rx, mut initial, mut shutdown_rx, done)| async move {
            if done {
                return None;
            }
            if *shutdown_rx.borrow() {
                return Some((
                    Ok::<Event, Infallible>(
                        Event::default()
                            .event("host_stopped")
                            .data("{\"kind\":\"host_stopped\",\"reason\":\"disabled\"}"),
                    ),
                    (rx, None, shutdown_rx, true),
                ));
            }
            if let Some(first) = initial.take() {
                return Some((
                    Ok::<Event, Infallible>(Event::default().event("companion").data(first)),
                    (rx, None, shutdown_rx, false),
                ));
            }
            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        let _ = changed;
                        return Some((
                            Ok::<Event, Infallible>(
                                Event::default()
                                    .event("host_stopped")
                                    .data("{\"kind\":\"host_stopped\",\"reason\":\"disabled\"}"),
                            ),
                            (rx, None, shutdown_rx, true),
                        ));
                    }
                    res = rx.recv() => {
                        match res {
                            Ok(msg) => {
                                return Some((
                                    Ok(Event::default().event("companion").data(msg)),
                                    (rx, None, shutdown_rx, false),
                                ));
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(broadcast::error::RecvError::Closed) => return None,
                        }
                    }
                }
            }
        },
    );

    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping"))
        .into_response()
}

fn is_valid_action_payload(body: &Value) -> bool {
    body.as_object()
        .and_then(|obj| obj.get("type"))
        .and_then(Value::as_str)
        .is_some_and(|kind| !kind.trim().is_empty() && kind.len() <= 64)
}

async fn api_action(
    AxumState(state): AxumState<AxumHostState>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if !is_authorized(&state, &headers, query.token.as_deref()) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    }
    if !is_valid_action_payload(&body) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_action" }))).into_response();
    }
    let _ = state.app.emit("web-host-action", body);
    Json(json!({ "ok": true })).into_response()
}

fn detect_host_name() -> String {
    for key in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(val) = std::env::var(key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    "StreamDash PC".to_string()
}

fn build_discovery_payload(port: u16, auth_required: bool) -> Value {
    json!({
        "service": "streamdash-host",
        "version": env!("CARGO_PKG_VERSION"),
        "hostName": detect_host_name(),
        "port": port,
        "ips": detect_local_ips(),
        "authRequired": auth_required,
    })
}

fn detect_local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0")
        && socket.connect("8.8.8.8:80").is_ok()
        && let Ok(local) = socket.local_addr()
        && let IpAddr::V4(v4) = local.ip()
        && !v4.is_loopback()
    {
        ips.push(v4.to_string());
    }
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }
    ips
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_match_requires_exact_non_empty_token() {
        assert!(tokens_match("  AB12CD34 ", "AB12CD34"));
        assert!(!tokens_match("", ""));
        assert!(!tokens_match("AB12CD34", ""));
        assert!(!tokens_match("AB12CD35", "AB12CD34"));
        assert!(!tokens_match("AB12CD3", "AB12CD34"));
    }

    #[test]
    fn sanitize_token_strips_cookie_delimiters_and_whitespace() {
        assert_eq!(sanitize_token(" ab;12\r\n\"cd "), "ab12cd");
    }

    #[test]
    fn unsafe_path_segments_detects_traversal() {
        assert!(has_unsafe_path_segments("../secret"));
        assert!(has_unsafe_path_segments("assets/../../etc/passwd"));
        assert!(has_unsafe_path_segments("assets\\main.js"));
        assert!(!has_unsafe_path_segments("assets/index-123.js"));
    }

    #[test]
    fn valid_action_payload_requires_non_empty_type() {
        assert!(is_valid_action_payload(&json!({ "type": "obs.scene", "payload": {} })));
        assert!(!is_valid_action_payload(&json!({ "payload": {} })));
        assert!(!is_valid_action_payload(&json!({ "type": "   " })));
        assert!(!is_valid_action_payload(&json!("obs.scene")));
    }

    #[test]
    fn generate_token_is_eight_hex_chars() {
        let tok = generate_token();
        assert_eq!(tok.len(), 8);
        assert!(tok.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn discovery_payload_never_exposes_token() {
        let payload = build_discovery_payload(48950, true);
        assert_eq!(payload["service"], "streamdash-host");
        assert_eq!(payload["port"], 48950);
        assert_eq!(payload["authRequired"], true);
        assert!(payload.get("token").is_none());
    }

    #[test]
    fn generate_verify_code_is_formatted_six_digits() {
        let code = generate_verify_code();
        let parts: Vec<&str> = code.split(' ').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].len(), 3);
        assert_eq!(parts[1].len(), 3);
        assert!(parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())));
    }

    #[test]
    fn sanitize_device_name_strips_controls_and_defaults() {
        assert_eq!(sanitize_device_name(Some("  Pixel\n8  ")), "Pixel8");
        assert_eq!(sanitize_device_name(Some("   ")), "Android Companion");
        assert_eq!(sanitize_device_name(None), "Android Companion");
    }
}
