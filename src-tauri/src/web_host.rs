use std::{
    convert::Infallible,
    net::{IpAddr, SocketAddr, UdpSocket},
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicUsize, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Duration,
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
use tokio::sync::broadcast;

pub const DEFAULT_HOST_PORT: u16 = 48_950;

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
        "SD48950".to_string()
    }
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

#[derive(Clone)]
struct AxumHostState {
    app: AppHandle,
    require_auth: Arc<AtomicBool>,
    token: Arc<RwLock<String>>,
    snapshot_json: Arc<RwLock<String>>,
    tx: broadcast::Sender<String>,
    connected_clients: Arc<AtomicUsize>,
}

pub struct WebHostRuntime {
    app: AppHandle,
    enabled: AtomicBool,
    running: Arc<AtomicBool>,
    port: AtomicU16,
    require_auth: Arc<AtomicBool>,
    token: Arc<RwLock<String>>,
    snapshot_json: Arc<RwLock<String>>,
    tx: broadcast::Sender<String>,
    connected_clients: Arc<AtomicUsize>,
    last_error: Arc<RwLock<Option<String>>>,
    server_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
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
        let runtime = Self {
            app,
            enabled: AtomicBool::new(enabled),
            running: Arc::new(AtomicBool::new(false)),
            port: AtomicU16::new(if port >= 1024 { port } else { DEFAULT_HOST_PORT }),
            require_auth: Arc::new(AtomicBool::new(require_auth)),
            token: Arc::new(RwLock::new(if token.trim().is_empty() {
                generate_token()
            } else {
                token.trim().to_string()
            })),
            snapshot_json: Arc::new(RwLock::new("{}".to_string())),
            tx,
            connected_clients: Arc::new(AtomicUsize::new(0)),
            last_error: Arc::new(RwLock::new(None)),
            server_task: Mutex::new(None),
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
            let trimmed = t.trim().to_string();
            if !trimmed.is_empty() {
                *self.token.write().unwrap_or_else(|e| e.into_inner()) = trimmed;
            }
        }

        if !enabled {
            self.stop_server();
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
        if let Ok(json_str) = serde_json::to_string(&snapshot) {
            *self
                .snapshot_json
                .write()
                .unwrap_or_else(|e| e.into_inner()) = json_str.clone();
            let _ = self.tx.send(json_str);
        }
    }

    fn stop_server(&self) {
        if let Ok(mut guard) = self.server_task.lock()
            && let Some(handle) = guard.take()
        {
            handle.abort();
        }
        self.running.store(false, Ordering::Relaxed);
    }

    fn restart_server(&self) -> Result<(), String> {
        self.stop_server();
        let port = self.port.load(Ordering::Relaxed);
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        let listener = std::net::TcpListener::bind(addr).map_err(|e| {
            let msg = format!("Port {port}: {e}");
            *self.last_error.write().unwrap_or_else(|e| e.into_inner()) = Some(msg.clone());
            msg
        })?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;

        *self.last_error.write().unwrap_or_else(|e| e.into_inner()) = None;
        self.running.store(true, Ordering::Relaxed);

        let shared = AxumHostState {
            app: self.app.clone(),
            require_auth: self.require_auth.clone(),
            token: self.token.clone(),
            snapshot_json: self.snapshot_json.clone(),
            tx: self.tx.clone(),
            connected_clients: self.connected_clients.clone(),
        };

        let router = Router::new()
            .route("/api/health", get(api_health))
            .route("/api/host-status", get(api_host_status))
            .route("/api/state", get(api_state))
            .route("/api/events", get(api_events))
            .route("/api/action", post(api_action))
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
            if let Err(e) = axum::serve(listener, router).await {
                log::error!("Web host server stopped: {e}");
                *err_slot.write().unwrap_or_else(|er| er.into_inner()) = Some(e.to_string());
            }
            running_flag.store(false, Ordering::Relaxed);
        });

        if let Ok(mut guard) = self.server_task.lock() {
            *guard = Some(handle);
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
        && q.trim() == expected
    {
        return true;
    }
    if let Some(hdr) = headers.get("x-sd-token").and_then(|v| v.to_str().ok())
        && hdr.trim() == expected
    {
        return true;
    }
    if let Some(auth) = headers.get("authorization").and_then(|v| v.to_str().ok())
        && let Some(bearer) = auth.strip_prefix("Bearer ")
        && bearer.trim() == expected
    {
        return true;
    }
    if let Some(cookie_hdr) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        for part in cookie_hdr.split(';') {
            if let Some((k, v)) = part.trim().split_once('=')
                && k.trim() == "sd_host_token"
                && v.trim() == expected
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
                if q_tok.trim() == expected {
                    let cookie = format!(
                        "sd_host_token={expected}; Path=/; HttpOnly; SameSite=Lax"
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
    let rel_path = if raw_path.is_empty() { "index.html" } else { raw_path };
    // In `tauri dev`, always prefer the live Vite dev server so we never serve a stale `dist/`.
    if cfg!(debug_assertions) {
        static VITE_BASE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        let base = VITE_BASE.get_or_init(|| {
            for candidate in ["127.0.0.1:1420", "[::1]:1420"] {
                if let Ok(addr) = candidate.parse()
                    && std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
                {
                    return format!("http://{candidate}");
                }
            }
            "http://localhost:1420".to_string()
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
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, asset.mime_type)
            .body(Body::from(asset.bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}

async fn api_health(AxumState(state): AxumState<AxumHostState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "authRequired": state.require_auth.load(Ordering::Relaxed),
    }))
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
    let val: Value = serde_json::from_str(&raw).unwrap_or(json!({}));
    Json(val).into_response()
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

    let stream =
        stream::unfold((rx, Some(initial), guard), |(mut rx, mut initial, guard)| async move {
            if let Some(first) = initial.take() {
                return Some((Ok::<Event, Infallible>(Event::default().event("state").data(first)), (rx, None, guard)));
            }
            loop {
                match rx.recv().await {
                    Ok(msg) => {
                        return Some((Ok(Event::default().event("state").data(msg)), (rx, None, guard)));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        });

    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping"))
        .into_response()
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
    let _ = state.app.emit("web-host-action", body);
    Json(json!({ "ok": true })).into_response()
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
