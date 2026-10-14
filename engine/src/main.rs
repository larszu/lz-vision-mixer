//! LZ Vision Mixer — engine. Runs the GStreamer mixer and serves the control
//! API and the web UI.

mod easing;
mod devices;
mod format;
mod layout;
mod mixer;
mod runner;
mod server;
mod specs;
mod state;
mod vfa;

use anyhow::{Context, Result};
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Parser)]
#[command(version, about = "LZ Vision Mixer engine")]
struct Args {
    /// Address for the web UI and API. Use 0.0.0.0:4195 to allow other devices.
    #[arg(long, default_value = "127.0.0.1:4195")]
    listen: SocketAddr,
    /// Programme format: 720p50, 1080p25, 1080p29.97, 1080p50, 1080p59.94, 2160p25 …
    #[arg(long, default_value = "1080p50")]
    format: String,
    /// Settings file (inputs, transition, overlays). Default: the user config folder.
    #[arg(long)]
    config: Option<PathBuf>,
    /// Do not remember settings between runs.
    #[arg(long)]
    no_config: bool,
    /// Open the web UI in the browser after start.
    #[arg(long)]
    open: bool,
    /// First TCP port for graphics frames from the renderer (one per layer).
    #[arg(long, default_value_t = 4198)]
    frame_port: u16,
    /// Start this graphics renderer (the LZ Vision Mixer Graphics app or its
    /// executable) and connect it.
    #[arg(long)]
    renderer: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "lz_vision_mixer=info".into()),
        )
        .init();
    let args = Args::parse();
    gstreamer::init().context("GStreamer is not installed or cannot start")?;
    let format = format::Format::parse(&args.format)?;
    let config = if args.no_config {
        None
    } else {
        args.config.or_else(|| dirs::config_dir().map(|d| d.join("lz-vision-mixer").join("config.json")))
    };
    let mixer = mixer::Mixer::new(format.clone(), config, args.frame_port)?;
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .with_context(|| format!("cannot listen on {}", args.listen))?;
    let url = format!("http://{}", args.listen);
    tracing::info!("LZ Vision Mixer {} · {} · {url}", env!("CARGO_PKG_VERSION"), format.name);
    if args.open {
        let _ = open::that(url.replace("0.0.0.0", "127.0.0.1"));
    }
    let mut child = None;
    if let Some(path) = &args.renderer {
        let engine = format!("ws://127.0.0.1:{}/renderer", args.listen.port());
        // A macOS .app bundle is started through `open` so it gets its arguments.
        let mut cmd = if path.extension().is_some_and(|e| e == "app") {
            let mut c = std::process::Command::new("open");
            c.arg("-n").arg(path).arg("--args");
            c
        } else {
            std::process::Command::new(path)
        };
        match cmd.arg("--engine").arg(&engine).arg("--hidden").spawn() {
            Ok(c) => child = Some(c),
            Err(e) => tracing::error!("cannot start the graphics renderer {}: {e}", path.display()),
        }
    }
    let m = mixer.clone();
    axum::serve(listener, server::router(mixer))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    tracing::info!("stopping outputs");
    tokio::task::spawn_blocking(move || m.shutdown()).await?;
    if let Some(mut c) = child {
        let _ = c.kill();
    }
    Ok(())
}
