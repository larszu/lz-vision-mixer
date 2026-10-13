//! Video format of the mixer: every input is scaled and frame-synced to it.

use anyhow::{bail, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Format {
    pub width: i32,
    pub height: i32,
    /// Frames per second as a float, for the UI.
    pub fps: f64,
    pub name: String,
    #[serde(skip)]
    pub fps_n: i32,
    #[serde(skip)]
    pub fps_d: i32,
}

impl Format {
    /// "1080p50", "1080p59.94", "720p50", "2160p25" … (progressive only).
    pub fn parse(s: &str) -> Result<Format> {
        let Some((h, rate)) = s.split_once('p') else { bail!("format must look like 1080p50") };
        let height: i32 = h.parse()?;
        let width = match height {
            720 => 1280,
            1080 => 1920,
            2160 => 3840,
            _ => bail!("height must be 720, 1080 or 2160"),
        };
        let (fps_n, fps_d) = match rate {
            "23.98" | "23.976" => (24000, 1001),
            "29.97" => (30000, 1001),
            "59.94" => (60000, 1001),
            r => (r.parse::<i32>()?, 1),
        };
        if ![24000, 30000, 60000, 24, 25, 30, 50, 60].contains(&fps_n) {
            bail!("unsupported frame rate {rate}");
        }
        Ok(Format {
            width,
            height,
            fps: fps_n as f64 / fps_d as f64,
            name: s.to_string(),
            fps_n,
            fps_d,
        })
    }

    pub fn caps(&self, format: &str) -> String {
        format!(
            "video/x-raw,format={format},width={},height={},framerate={}/{},pixel-aspect-ratio=1/1",
            self.width, self.height, self.fps_n, self.fps_d
        )
    }

    /// Mode nick of the GStreamer DeckLink elements ("1080p50", "1080p5994").
    pub fn decklink_mode(&self) -> String {
        self.name.replace('.', "")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_formats() {
        let f = Format::parse("1080p50").unwrap();
        assert_eq!((f.width, f.height, f.fps_n, f.fps_d), (1920, 1080, 50, 1));
        let f = Format::parse("1080p59.94").unwrap();
        assert_eq!((f.fps_n, f.fps_d), (60000, 1001));
        assert_eq!(f.decklink_mode(), "1080p5994");
        assert!(Format::parse("1080i50").is_err());
        assert!(Format::parse("1080p49").is_err());
    }
}
