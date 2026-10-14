//! Source and output specs → GStreamer launch descriptions.
//!
//! Every input runs in a pipeline of its own that ends in an inter sink; the
//! mixer reads it back with an inter source. That is the frame sync: the
//! mixer runs on its own clock, repeats or drops frames of a source that runs
//! fast or slow, and shows black if a source dies — without the source being
//! able to stall the programme. Outputs work the same way in reverse.

use crate::format::Format;
use anyhow::{bail, Result};

/// Inter-audio buffering. The default (1 s buffer) lets audio fall a second
/// behind the picture; measured 1.15 s at 1080p50 before this was set.
pub const INTER_AUDIO: &str = "buffer-time=50000000 latency-time=20000000 period-time=10000000";
pub const AUDIO_CAPS: &str = "audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved";
/// Internal picture format. 8-bit 4:2:0 for now; 10-bit 4:2:2 is planned.
pub const VIDEO_FORMAT: &str = "I420";

/// Quotes a value for a launch line.
fn q(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn video_tail(f: &Format, slot: usize) -> String {
    format!(
        "videoconvert ! videoscale add-borders=true ! videorate ! {} ! queue max-size-buffers=3 leaky=downstream ! intervideosink channel=in{slot} async=false",
        f.caps(VIDEO_FORMAT)
    )
}

fn audio_tail(slot: usize) -> String {
    format!(
        "audioconvert ! audioresample ! {AUDIO_CAPS} ! queue ! interaudiosink channel=ain{slot} async=false"
    )
}

fn silence(slot: usize) -> String {
    format!("audiotestsrc is-live=true wave=silence ! {}", audio_tail(slot))
}

#[derive(Debug, Clone, PartialEq)]
pub struct InputPlan {
    pub launch: String,
    /// Seek back to the start on end of stream.
    pub looping: bool,
    /// Try again after an error (live sources that may come back).
    pub retry: bool,
    /// Suggested slot name.
    pub name: String,
}

pub fn input(spec: &str, f: &Format, slot: usize, has: impl Fn(&str) -> bool) -> Result<InputPlan> {
    let (kind, rest) = spec.split_once(':').unwrap_or((spec, ""));
    let v = video_tail(f, slot);
    let a = audio_tail(slot);
    let plan = |launch: String, looping, retry, name: String| Ok(InputPlan { launch, looping, retry, name });
    match kind {
        "test" => {
            let (pattern, tone) = match rest {
                "smpte" | "" => ("smpte", true),
                "bars" => ("smpte100", true),
                "ball" => ("ball", false),
                "black" => ("black", false),
                "snow" => ("snow", false),
                other => bail!("unknown test pattern '{other}'"),
            };
            let audio = if tone {
                format!("audiotestsrc is-live=true wave=sine freq=1000 volume=0.125 ! {a}")
            } else {
                silence(slot)
            };
            plan(
                format!("videotestsrc is-live=true pattern={pattern} ! {v} {audio}"),
                false,
                false,
                format!("Test {}", if rest.is_empty() { "smpte" } else { rest }),
            )
        }
        "decklink" => {
            if !has("decklinkvideosrc") {
                bail!("DeckLink support is not available (GStreamer decklink plugin missing)");
            }
            let n: u32 = rest.parse().map_err(|_| anyhow::anyhow!("decklink:<device number>"))?;
            plan(
                format!(
                    "decklinkvideosrc device-number={n} mode=auto connection=auto ! {v} decklinkaudiosrc device-number={n} channels=2 ! {a}"
                ),
                false,
                true,
                format!("DeckLink {}", n + 1),
            )
        }
        "ndi" => {
            if !has("ndisrc") {
                bail!("NDI is not available: install the NDI runtime from ndi.video");
            }
            if rest.is_empty() {
                bail!("ndi:<source name>");
            }
            plan(
                format!(
                    "ndisrc ndi-name={} ! ndisrcdemux name=d d.video ! queue ! {v} d.audio ! queue ! {a}",
                    q(rest)
                ),
                false,
                true,
                rest.to_string(),
            )
        }
        "file" | "image" => {
            let path = std::path::Path::new(rest);
            if !path.exists() {
                bail!("file not found: {rest}");
            }
            let uri = gstreamer::glib::filename_to_uri(path, None)?.to_string();
            let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if kind == "image" {
                plan(
                    format!("uridecodebin3 uri={} name=d d. ! imagefreeze is-live=true ! {v} {}", q(&uri), silence(slot)),
                    false,
                    false,
                    name,
                )
            } else {
                // Delayed links: uridecodebin's pads appear later; videoconvert
                // and audioconvert only accept their kind, so each pad finds
                // the right branch. A file without audio leaves that branch
                // unlinked, which the async=false sink tolerates.
                plan(format!("uridecodebin3 uri={} name=d d. ! {v} d. ! {a}", q(&uri)), true, false, name)
            }
        }
        "srt" | "rtmp" | "rtmps" | "rtsp" | "http" | "https" | "udp" => {
            if kind == "srt" && !has("srtsrc") {
                bail!("SRT support is not available (GStreamer srt plugin missing)");
            }
            plan(
                format!("uridecodebin3 uri={} name=d d. ! {v} d. ! {a}", q(spec)),
                false,
                true,
                spec.split("//").nth(1).unwrap_or(spec).split(['/', '?']).next().unwrap_or(spec).to_string(),
            )
        }
        "st2110" => bail!(
            "SMPTE ST 2110 input needs the Intel Media Transport Library GStreamer plugin; not wired up yet"
        ),
        _ => bail!("unknown source '{spec}'"),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OutputPlan {
    pub launch: String,
    /// Needs end-of-stream before stopping so the file gets finalised.
    pub needs_eos: bool,
}

fn video_in(f: &Format, channel: &str) -> String {
    format!("intervideosrc channel={channel} ! {} ! queue", f.caps(VIDEO_FORMAT))
}

fn audio_in() -> String {
    format!("interaudiosrc channel=pgma {INTER_AUDIO} ! {AUDIO_CAPS} ! queue")
}

/// First available element of a list, with its settings for a given bitrate.
fn h264(has: &impl Fn(&str) -> bool, kbps: u32, f: &Format) -> Result<String> {
    let gop = (f.fps * 2.0).round() as u32;
    if has("vtenc_h264_hw") {
        return Ok(format!(
            "vtenc_h264_hw realtime=true allow-frame-reordering=false bitrate={kbps} max-keyframe-interval={gop}"
        ));
    }
    if has("nvh264enc") {
        return Ok(format!("nvh264enc bitrate={kbps} gop-size={gop} zerolatency=true"));
    }
    if has("qsvh264enc") {
        return Ok(format!("qsvh264enc bitrate={kbps} gop-size={gop} low-latency=true"));
    }
    if has("x264enc") {
        return Ok(format!(
            "x264enc tune=zerolatency speed-preset=veryfast bitrate={kbps} key-int-max={gop}"
        ));
    }
    bail!("no H.264 encoder available")
}

fn aac(has: &impl Fn(&str) -> bool) -> Result<String> {
    for e in ["avenc_aac", "fdkaacenc", "voaacenc", "faac"] {
        if has(e) {
            return Ok(format!("{e} bitrate=192000"));
        }
    }
    bail!("no AAC encoder available")
}

pub fn encoders(has: impl Fn(&str) -> bool) -> Vec<String> {
    ["vtenc_h264_hw", "nvh264enc", "qsvh264enc", "x264enc", "vtenc_prores", "avenc_prores_ks", "avenc_aac", "fdkaacenc", "voaacenc"]
        .into_iter()
        .filter(|e| has(e))
        .map(String::from)
        .collect()
}

pub fn output(spec: &str, f: &Format, has: impl Fn(&str) -> bool) -> Result<OutputPlan> {
    let (kind, rest) = spec.split_once(':').unwrap_or((spec, ""));
    let plan = |launch: String, needs_eos| Ok(OutputPlan { launch, needs_eos });
    match kind {
        "decklink" | "decklink-mv" => {
            if !has("decklinkvideosink") {
                bail!("DeckLink support is not available (GStreamer decklink plugin missing)");
            }
            let n: u32 = rest.parse().map_err(|_| anyhow::anyhow!("{kind}:<device number>"))?;
            let mode = f.decklink_mode();
            let video = if kind == "decklink" {
                video_in(f, "pgm")
            } else {
                // The multiview runs at 1280×720/25; scale it up to the output mode.
                format!(
                    "intervideosrc channel=mv ! video/x-raw,format={VIDEO_FORMAT},width=1280,height=720,framerate=25/1 ! queue ! videoscale ! videorate ! {}",
                    f.caps(VIDEO_FORMAT)
                )
            };
            plan(
                format!(
                    "{video} ! videoconvert ! decklinkvideosink device-number={n} mode={mode} {} ! audioconvert ! decklinkaudiosink device-number={n}",
                    audio_in()
                ),
                false,
            )
        }
        "ndi" => {
            if !has("ndisink") {
                bail!("NDI is not available: install the NDI runtime from ndi.video");
            }
            let name = if rest.is_empty() { "LZ Vision Mixer" } else { rest };
            plan(
                format!(
                    "ndisinkcombiner name=c ! ndisink ndi-name={} {} ! videoconvert ! video/x-raw,format=UYVY ! c.video {} ! audioconvert ! c.audio",
                    q(name),
                    video_in(f, "pgm"),
                    audio_in()
                ),
                false,
            )
        }
        "srt" => {
            if !has("srtsink") {
                bail!("SRT support is not available (GStreamer srt plugin missing)");
            }
            plan(
                format!(
                    "mpegtsmux name=m alignment=7 ! srtsink uri={} wait-for-connection=false {} ! videoconvert ! {} ! h264parse config-interval=-1 ! queue ! m. {} ! audioconvert ! {} ! aacparse ! queue ! m.",
                    q(spec),
                    video_in(f, "pgm"),
                    h264(&has, 6000, f)?,
                    audio_in(),
                    aac(&has)?
                ),
                false,
            )
        }
        "rtmp" | "rtmps" => plan(
            format!(
                "flvmux name=m streamable=true ! rtmp2sink location={} {} ! videoconvert ! {} ! h264parse ! queue ! m. {} ! audioconvert ! {} ! aacparse ! queue ! m.",
                q(spec),
                video_in(f, "pgm"),
                h264(&has, 6000, f)?,
                audio_in(),
                aac(&has)?
            ),
            false,
        ),
        "record" => {
            if rest.is_empty() {
                bail!("record:<file path>");
            }
            let prores = if has("vtenc_prores") {
                // Apple's hardware ProRes keeps up with 1080p50; the software one does not.
                Some("videoconvert ! video/x-raw,format=UYVY ! vtenc_prores realtime=true ! video/x-prores,variant=hq")
            } else if has("avenc_prores_ks") {
                Some("videoconvert ! video/x-raw,format=Y444_10LE ! avenc_prores_ks profile=hq threads=0")
            } else {
                None
            };
            if let (true, Some(prores)) = (rest.to_lowercase().ends_with(".mov"), prores) {
                plan(
                    format!(
                        "qtmux name=m ! filesink location={} {} ! {prores} ! queue ! m. {} ! audioconvert ! audio/x-raw,format=S24LE ! queue ! m.",
                        q(rest),
                        video_in(f, "pgm"),
                        audio_in()
                    ),
                    true,
                )
            } else {
                // The index is written ahead and refreshed every 5 s: a crash leaves a
                // playable file. Fragmented MP4 lost the start offset of the video
                // track (audio 150 ms late in players), this does not.
                plan(
                    format!(
                        "mp4mux name=m reserved-max-duration=43200000000000 reserved-moov-update-period=5000000000 ! filesink location={} {} ! videoconvert ! {} ! h264parse ! queue ! m. {} ! audioconvert ! {} ! aacparse ! queue ! m.",
                        q(rest),
                        video_in(f, "pgm"),
                        h264(&has, 20000, f)?,
                        audio_in(),
                        aac(&has)?
                    ),
                    true,
                )
            }
        }
        "st2110" => bail!(
            "SMPTE ST 2110 output needs the Intel Media Transport Library GStreamer plugin; not wired up yet"
        ),
        _ => bail!("unknown output '{spec}'"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(_: &str) -> bool {
        true
    }
    fn none(_: &str) -> bool {
        false
    }

    #[test]
    fn test_pattern_feeds_its_slot() {
        let f = Format::parse("1080p50").unwrap();
        let p = input("test:bars", &f, 3, all).unwrap();
        assert!(p.launch.contains("pattern=smpte100"));
        assert!(p.launch.contains("channel=in3"));
        assert!(p.launch.contains("channel=ain3"));
    }

    #[test]
    fn missing_plugins_are_reported_not_attempted() {
        let f = Format::parse("1080p50").unwrap();
        assert!(input("decklink:0", &f, 1, none).unwrap_err().to_string().contains("DeckLink"));
        assert!(output("ndi:x", &f, none).is_err());
    }

    #[test]
    fn quoting_survives_spaces_and_quotes() {
        assert_eq!(q(r#"Cam "A" 1"#), r#""Cam \"A\" 1""#);
    }

    #[test]
    fn decklink_output_uses_the_mixer_mode() {
        let f = Format::parse("1080p59.94").unwrap();
        let p = output("decklink:1", &f, all).unwrap();
        assert!(p.launch.contains("device-number=1 mode=1080p5994"));
    }

    #[test]
    fn network_names_are_short() {
        let f = Format::parse("1080p50").unwrap();
        let p = input("srt://10.0.0.5:9000?mode=caller", &f, 1, all).unwrap();
        assert_eq!(p.name, "10.0.0.5:9000");
        assert!(p.retry);
    }
}
