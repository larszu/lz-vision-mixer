//! Native file and folder dialogs (Finder, Explorer, GTK/KDE) on the
//! machine the engine runs on, so the web UI can pick local media.
//!
//! The browser cannot hand out a file's path; the engine needs the path,
//! because it plays the file itself. Each platform's own dialog tool is
//! called as a process, which also keeps it off any of our threads.

use anyhow::Result;
use serde::Deserialize;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PickKind {
    Video,
    Image,
    Folder,
    Sdp,
    Save,
}

fn run(mut cmd: Command) -> Result<Option<String>> {
    let out = cmd.output()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Cancel is a non-zero exit (osascript, zenity) or empty output (PowerShell).
    if !out.status.success() || path.is_empty() {
        return Ok(None);
    }
    Ok(Some(path))
}

#[cfg(target_os = "macos")]
pub fn pick(kind: PickKind) -> Result<Option<String>> {
    let chooser = match kind {
        PickKind::Video => r#"choose file with prompt "Video file" of type {"public.movie", "public.mpeg-2-transport-stream", "org.matroska.mkv", "com.apple.quicktime-movie"}"#,
        PickKind::Image => r#"choose file with prompt "Still image" of type {"public.image"}"#,
        PickKind::Folder => r#"choose folder with prompt "Folder""#,
        PickKind::Sdp => r#"choose file with prompt "SDP file""#,
        PickKind::Save => r#"choose file name with prompt "Record to" default name "recording.mp4""#,
    };
    // Shown by the frontmost app (usually the browser), so it comes up in front.
    let script = format!("tell application (path to frontmost application as text) to POSIX path of ({chooser})");
    let mut cmd = Command::new("osascript");
    cmd.arg("-e").arg(script);
    run(cmd)
}

#[cfg(target_os = "windows")]
pub fn pick(kind: PickKind) -> Result<Option<String>> {
    let ps = match kind {
        PickKind::Folder => "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){ $d.SelectedPath }".to_string(),
        k => {
            let (class, filter) = match k {
                PickKind::Video => ("OpenFileDialog", "Video|*.mp4;*.mov;*.mkv;*.mxf;*.avi;*.ts;*.m4v|All files|*.*"),
                PickKind::Image => ("OpenFileDialog", "Images|*.png;*.jpg;*.jpeg;*.tif;*.tiff;*.bmp;*.webp|All files|*.*"),
                PickKind::Sdp => ("OpenFileDialog", "SDP|*.sdp|All files|*.*"),
                _ => ("SaveFileDialog", "MP4|*.mp4|QuickTime|*.mov"),
            };
            format!("Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.{class}; $d.Filter='{filter}'; if($d.ShowDialog() -eq 'OK'){{ $d.FileName }}")
        }
    };
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-STA", "-Command", &ps]);
    run(cmd)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn pick(kind: PickKind) -> Result<Option<String>> {
    let mut cmd = Command::new("zenity");
    cmd.arg("--file-selection");
    match kind {
        PickKind::Folder => {
            cmd.arg("--directory");
        }
        PickKind::Video => {
            cmd.arg("--file-filter=Video | *.mp4 *.mov *.mkv *.mxf *.avi *.ts *.m4v");
        }
        PickKind::Image => {
            cmd.arg("--file-filter=Images | *.png *.jpg *.jpeg *.tif *.tiff *.bmp *.webp");
        }
        PickKind::Sdp => {
            cmd.arg("--file-filter=SDP | *.sdp");
        }
        PickKind::Save => {
            cmd.args(["--save", "--confirm-overwrite"]);
        }
    }
    match run(cmd) {
        Ok(r) => Ok(r),
        Err(_) => anyhow::bail!("no file dialog available: install zenity"),
    }
}
