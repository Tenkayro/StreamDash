use axum::{
    Json, Router,
    extract::State as AxumState,
    http::{HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use std::{
    net::SocketAddr,
    sync::{Arc, RwLock},
    time::Duration,
};
use tauri::State;

const OVERLAY_HTML: &str = include_str!("spotify_overlay.html");

#[derive(Clone, Default, PartialEq)]
struct SpotifyMedia {
    available: bool,
    playing: bool,
    title: String,
    artist: String,
    album: String,
    cover: Vec<u8>,
    cover_type: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyNowPlaying {
    available: bool,
    playing: bool,
    title: String,
    artist: String,
    album: String,
    has_cover: bool,
    revision: u64,
}

#[derive(Default)]
struct SpotifyState {
    media: SpotifyMedia,
    revision: u64,
}

type SharedState = Arc<RwLock<SpotifyState>>;

pub struct SpotifyOverlayRuntime {
    base_url: String,
    state: SharedState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyOverlayInfo {
    url: String,
    width: u16,
    height: u16,
}

fn public_status(value: &SpotifyState) -> SpotifyNowPlaying {
    SpotifyNowPlaying {
        available: value.media.available,
        playing: value.media.playing,
        title: value.media.title.clone(),
        artist: value.media.artist.clone(),
        album: value.media.album.clone(),
        has_cover: !value.media.cover.is_empty(),
        revision: value.revision,
    }
}

async fn overlay() -> Html<&'static str> {
    Html(OVERLAY_HTML)
}

async fn status(AxumState(state): AxumState<SharedState>) -> Json<SpotifyNowPlaying> {
    Json(public_status(
        &state.read().unwrap_or_else(|error| error.into_inner()),
    ))
}

async fn cover(AxumState(state): AxumState<SharedState>) -> Response {
    let value = state.read().unwrap_or_else(|error| error.into_inner());
    if value.media.cover.is_empty() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let content_type = HeaderValue::from_str(&value.media.cover_type)
        .unwrap_or_else(|_| HeaderValue::from_static("image/jpeg"));
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
        value.media.cover.clone(),
    )
        .into_response()
}

pub fn start(port: u16) -> Result<SpotifyOverlayRuntime, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = std::net::TcpListener::bind(address)
        .map_err(|error| format!("Spotify overlay port {port}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let state = Arc::new(RwLock::new(SpotifyState::default()));
    let router = Router::new()
        .route("/spotify", get(overlay))
        .route("/api/spotify", get(status))
        .route("/cover", get(cover))
        .with_state(state.clone());
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                log::error!("Spotify overlay listener failed: {error}");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router).await {
            log::error!("Spotify overlay server stopped: {error}");
        }
    });
    let poll_state = state.clone();
    std::thread::Builder::new()
        .name("spotify-media-session".into())
        .spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            runtime.block_on(async move {
                loop {
                    let media = read_spotify().await.unwrap_or_default();
                    {
                        let mut value = poll_state
                            .write()
                            .unwrap_or_else(|error| error.into_inner());
                        if value.media != media {
                            value.media = media;
                            value.revision = value.revision.wrapping_add(1);
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(750)).await;
                }
            });
        })
        .map_err(|error| error.to_string())?;
    Ok(SpotifyOverlayRuntime {
        base_url: format!("http://127.0.0.1:{port}"),
        state,
    })
}

#[tauri::command]
pub fn spotify_overlay_info(runtime: State<'_, SpotifyOverlayRuntime>) -> SpotifyOverlayInfo {
    SpotifyOverlayInfo {
        url: format!("{}/spotify", runtime.base_url),
        width: 700,
        height: 160,
    }
}

#[tauri::command]
pub fn spotify_overlay_status(runtime: State<'_, SpotifyOverlayRuntime>) -> SpotifyNowPlaying {
    public_status(
        &runtime
            .state
            .read()
            .unwrap_or_else(|error| error.into_inner()),
    )
}

#[cfg(windows)]
async fn read_spotify() -> Option<SpotifyMedia> {
    use windows::{
        Media::Control::{
            GlobalSystemMediaTransportControlsSession,
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        },
        Storage::Streams::DataReader,
    };
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .await
        .ok()?;
    let is_spotify = |session: &GlobalSystemMediaTransportControlsSession| {
        session
            .SourceAppUserModelId()
            .map(|id| id.to_string().to_lowercase().contains("spotify"))
            .unwrap_or(false)
    };
    let playback_priority = |session: &GlobalSystemMediaTransportControlsSession| {
        match session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
        {
            Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) => 3,
            Ok(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused) => 2,
            Ok(_) => 1,
            Err(_) => 0,
        }
    };
    let mut spotify_sessions: Vec<_> = manager
        .GetSessions()
        .ok()?
        .into_iter()
        .filter(&is_spotify)
        .collect();
    if let Ok(current) = manager.GetCurrentSession() {
        if is_spotify(&current) {
            spotify_sessions.push(current);
        }
    }
    let last_updated = |session: &GlobalSystemMediaTransportControlsSession| {
        session
            .GetTimelineProperties()
            .and_then(|timeline| timeline.LastUpdatedTime())
            .map(|time| time.UniversalTime)
            .unwrap_or_default()
    };
    let session = spotify_sessions
        .into_iter()
        .max_by_key(|session| (playback_priority(session), last_updated(session)))?;
    let properties = session.TryGetMediaPropertiesAsync().ok()?.await.ok()?;
    let playback = session.GetPlaybackInfo().ok();
    let playing = playback
        .and_then(|value| value.PlaybackStatus().ok())
        .is_some_and(|status| {
            status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
        });
    let (cover, cover_type) = if let Ok(reference) = properties.Thumbnail() {
        if let Ok(operation) = reference.OpenReadAsync() {
            if let Ok(stream) = operation.await {
                let content_type = stream
                    .ContentType()
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                let bytes = async {
                    let size = stream.Size().ok()?.min(10_000_000) as u32;
                    let input = stream.GetInputStreamAt(0).ok()?;
                    let reader = DataReader::CreateDataReader(&input).ok()?;
                    let loaded = reader.LoadAsync(size).ok()?.await.ok()?;
                    let mut bytes = vec![0; loaded as usize];
                    reader.ReadBytes(&mut bytes).ok()?;
                    Some(bytes)
                }
                .await
                .unwrap_or_default();
                (bytes, content_type)
            } else {
                (Vec::new(), String::new())
            }
        } else {
            (Vec::new(), String::new())
        }
    } else {
        (Vec::new(), String::new())
    };
    Some(SpotifyMedia {
        available: true,
        playing,
        title: properties
            .Title()
            .map(|value| value.to_string())
            .unwrap_or_default(),
        artist: properties
            .Artist()
            .map(|value| value.to_string())
            .unwrap_or_default(),
        album: properties
            .AlbumTitle()
            .map(|value| value.to_string())
            .unwrap_or_default(),
        cover,
        cover_type,
    })
}

#[cfg(not(windows))]
async fn read_spotify() -> Option<SpotifyMedia> {
    None
}
