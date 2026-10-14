//! HTTP + WebSocket control (docs/api.md) and the embedded web UI.

use crate::mixer::Mixer;
use crate::state::Command;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use rust_embed::RustEmbed;
use serde_json::json;
use std::sync::Arc;
use tokio_stream::wrappers::WatchStream;

#[derive(RustEmbed)]
#[folder = "../ui/dist"]
#[allow_missing = true]
struct Ui;

type Shared = Arc<Mixer>;

pub fn router(mixer: Shared) -> Router {
    Router::new()
        .route("/ws", get(ws))
        .route("/api/state", get(|State(m): State<Shared>| async move { Json(m.state()) }))
        .route("/api/cmd", post(cmd))
        .route("/api/cut", get(|s| shortcut(s, json!({"cmd":"cut"}))))
        .route("/api/auto", get(|s| shortcut(s, json!({"cmd":"auto"}))))
        .route("/api/ftb", get(|s| shortcut(s, json!({"cmd":"ftb"}))))
        .route("/api/preview/{slot}", get(|s, Path(n): Path<usize>| shortcut(s, json!({"cmd":"preview","slot":n}))))
        .route("/api/program/{slot}", get(|s, Path(n): Path<usize>| shortcut(s, json!({"cmd":"program","slot":n}))))
        .route("/api/tbar/{value}", get(|s, Path(v): Path<f64>| shortcut(s, json!({"cmd":"tbar","value":v}))))
        .route("/api/overlay/{index}/toggle", get(overlay_toggle))
        .route("/api/vfa/on", get(|s| shortcut(s, json!({"cmd":"setVfa","enabled":true}))))
        .route("/api/vfa/off", get(|s| shortcut(s, json!({"cmd":"setVfa","enabled":false}))))
        .route("/api/vfa/toggle", get(vfa_toggle))
        .route("/api/gfx/{layer}/play", get(|s, Path(l): Path<usize>| shortcut(s, json!({"cmd":"gfxPlay","layer":l}))))
        .route("/api/gfx/{layer}/next", get(|s, Path(l): Path<usize>| shortcut(s, json!({"cmd":"gfxPlay","layer":l,"delta":1}))))
        .route("/api/gfx/{layer}/stop", get(|s, Path(l): Path<usize>| shortcut(s, json!({"cmd":"gfxStop","layer":l}))))
        .route("/renderer", get(renderer_ws))
        .route("/mjpeg/multiview", get(mjpeg))
        .fallback(static_ui)
        .with_state(mixer)
}

async fn run(m: Shared, c: Command) -> Result<(), String> {
    tokio::task::spawn_blocking(move || m.handle(c)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

fn reply(r: Result<(), String>) -> Response {
    match r {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

async fn cmd(State(m): State<Shared>, Json(v): Json<serde_json::Value>) -> Response {
    match serde_json::from_value::<Command>(v) {
        Ok(c) => reply(run(m, c).await),
        Err(e) => reply(Err(e.to_string())),
    }
}

async fn shortcut(State(m): State<Shared>, v: serde_json::Value) -> Response {
    cmd(State(m), Json(v)).await
}

async fn overlay_toggle(State(m): State<Shared>, Path(i): Path<usize>) -> Response {
    let on = m.state().overlays.get(i.wrapping_sub(1)).map(|o| !o.on_air).unwrap_or(true);
    shortcut(State(m), json!({"cmd":"overlayOn","index":i,"on":on})).await
}

async fn vfa_toggle(State(m): State<Shared>) -> Response {
    let on = !m.state().vfa.config.enabled;
    shortcut(State(m), json!({"cmd":"setVfa","enabled":on})).await
}

async fn renderer_ws(State(m): State<Shared>, up: WebSocketUpgrade) -> Response {
    // Frames arrive by TCP; this socket carries only small JSON messages.
    up.on_upgrade(move |socket| async move {
        let (mut tx, mut rx) = socket.split();
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let id = m.renderer_attach(out_tx);
        let writer = tokio::spawn(async move {
            while let Some(msg) = out_rx.recv().await {
                if tx.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
        });
        while let Some(Ok(msg)) = rx.next().await {
            if let Message::Text(t) = msg {
                m.renderer_message(&t);
            }
        }
        writer.abort();
        m.renderer_detach(id);
    })
}

async fn ws(State(m): State<Shared>, up: WebSocketUpgrade) -> Response {
    up.on_upgrade(move |socket| client(socket, m))
}

async fn client(socket: WebSocket, m: Shared) {
    let (mut tx, mut rx) = socket.split();
    let mut changed = m.changed.subscribe();
    let mut levels = m.levels.subscribe();
    let (err_tx, mut err_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let send_state = |m: &Mixer| json!({"type":"state","state": m.state()}).to_string();
    if tx.send(Message::Text(send_state(&m).into())).await.is_err() {
        return;
    }
    let m2 = m.clone();
    let reader = tokio::spawn(async move {
        while let Some(Ok(msg)) = rx.next().await {
            if let Message::Text(t) = msg {
                let r = match serde_json::from_str::<Command>(&t) {
                    Ok(c) => run(m2.clone(), c).await,
                    Err(e) => Err(e.to_string()),
                };
                if let Err(e) = r {
                    let _ = err_tx.send(e);
                }
            }
        }
    });
    loop {
        let out = tokio::select! {
            r = changed.changed() => { if r.is_err() { break } send_state(&m) }
            r = levels.changed() => {
                if r.is_err() { break }
                let l = levels.borrow_and_update().clone();
                json!({"type":"levels","levels": l}).to_string()
            }
            e = err_rx.recv() => match e { Some(e) => json!({"type":"error","message": e}).to_string(), None => break },
        };
        if tx.send(Message::Text(out.into())).await.is_err() {
            break;
        }
    }
    reader.abort();
}

async fn mjpeg(State(m): State<Shared>) -> Response {
    let stream = WatchStream::new(m.jpeg.subscribe()).filter_map(|jpg| async move {
        if jpg.is_empty() {
            return None;
        }
        let mut part = Vec::with_capacity(jpg.len() + 100);
        part.extend_from_slice(
            format!("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n", jpg.len()).as_bytes(),
        );
        part.extend_from_slice(&jpg);
        part.extend_from_slice(b"\r\n");
        Some(Ok::<_, std::convert::Infallible>(bytes::Bytes::from(part)))
    });
    Response::builder()
        .header(header::CONTENT_TYPE, "multipart/x-mixed-replace; boundary=frame")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn static_ui(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match Ui::get(path).or_else(|| if path.contains('.') { None } else { Ui::get("index.html") }) {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref().to_string())], f.data).into_response()
        }
        None if path == "index.html" => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            "<!doctype html><title>LZ Vision Mixer</title><p>The web UI was not built into this binary. Run <code>npm run build</code> in <code>ui/</code> and rebuild the engine. The API is up: <a href=\"/api/state\">/api/state</a>.</p>",
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
