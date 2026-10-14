//! Audio interfaces for the microphones: listing them and capturing one
//! channel of one device into a mic bus.
//!
//! GStreamer's device monitor covers CoreAudio, WASAPI and PulseAudio /
//! PipeWire alike and hands out a ready source element per device, so there
//! is no platform code here.

use crate::dsp::StripParams;
use crate::specs::AUDIO_CAPS;
use crate::strip_element::LzStrip;
use crate::state::AudioDevice;
use anyhow::{anyhow, Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;

pub struct Found {
    pub info: AudioDevice,
    pub device: gst::Device,
}

/// Highest channel count a device offers in its caps.
fn channels(dev: &gst::Device) -> u32 {
    let Some(caps) = dev.caps() else { return 2 };
    let mut best = 0;
    for s in caps.iter() {
        if let Ok(n) = s.get::<i32>("channels") {
            best = best.max(n);
        } else if let Ok(r) = s.get::<gst::IntRange<i32>>("channels") {
            // Ranges like 1..=2147483647 mean "anything"; trust only sane maxima.
            best = best.max(if r.max() <= 64 { r.max() } else { 2 });
        }
    }
    if best <= 0 { 2 } else { best as u32 }
}

pub fn list() -> Vec<Found> {
    list_class("Audio/Source")
}

/// Cameras and capture cards (USB, HDMI/SDI capture, built-in cameras).
pub fn list_video() -> Vec<Found> {
    list_class("Video/Source")
}

/// Audio outputs (interfaces, headphones, virtual devices like BlackHole).
pub fn list_outputs() -> Vec<Found> {
    list_class("Audio/Sink")
}

fn list_class(class: &str) -> Vec<Found> {
    let monitor = gst::DeviceMonitor::new();
    monitor.add_filter(Some(class), None);
    if monitor.start().is_err() {
        return Vec::new();
    }
    let devices = monitor.devices();
    monitor.stop();
    let mut out: Vec<Found> = Vec::new();
    for device in devices {
        let name = device.display_name().to_string();
        // Ids must be stable across a rescan; the name is, as long as the
        // same interface is plugged in. Duplicates get a counter.
        let mut id = name.clone();
        let mut n = 2;
        while out.iter().any(|f| f.info.id == id) {
            id = format!("{name} ({n})");
            n += 1;
        }
        let info = AudioDevice { id, name, channels: channels(&device) };
        out.push(Found { info, device });
    }
    out
}

/// One row that takes `channel` of `inputs` channels (to mono).
pub fn pick_matrix(inputs: u32, channel: u32) -> Vec<Vec<f32>> {
    vec![(0..inputs).map(|i| if i == channel { 1.0 } else { 0.0 }).collect()]
}

/// Pipeline: device → force its channel count → pick one channel (mono) →
/// optional RNNoise → channel strip → both sides → mic bus `mic<n>`.
pub fn mic_pipeline(dev: &Found, channel: u32, mic: usize, strip: &StripParams) -> Result<gst::Pipeline> {
    let ch = dev.info.channels.max(1);
    if channel >= ch {
        return Err(anyhow!("{} has {} channels; channel {} does not exist", dev.info.name, ch, channel + 1));
    }
    let pipeline = gst::Pipeline::new();
    let src = dev.device.create_element(None).context("device has no source element")?;
    let rest = gst::parse::bin_from_description(
        &format!(
            "audioconvert ! audio/x-raw,channels={ch} ! audioconvert name=pick ! audioresample ! audio/x-raw,format=F32LE,rate=48000,channels=1,layout=interleaved ! {denoise}lzstrip name=strip ! audioconvert ! {AUDIO_CAPS} ! queue ! interaudiosink channel=mic{mic} async=false",
            denoise = if strip.denoise { "audiornnoise ! " } else { "" }
        ),
        true,
    )?;
    let pick = rest.by_name("pick").context("pick")?;
    let matrix = gst::Array::new(
        pick_matrix(ch, channel)
            .into_iter()
            .map(|row| gst::Array::new(row.into_iter().map(|v| v.to_send_value())).to_send_value()),
    );
    pick.set_property("mix-matrix", matrix);
    if let Some(e) = rest.by_name("strip").and_then(|e| e.downcast::<LzStrip>().ok()) {
        e.set_params(strip.clone());
    }
    pipeline.add_many([&src, rest.upcast_ref()])?;
    src.link(&rest)?;
    Ok(pipeline)
}

/// Input slot from a capture device, with sound from an audio device or silence.
pub fn capture_pipeline(
    video: &Found,
    audio: Option<&Found>,
    f: &crate::format::Format,
    slot: usize,
) -> Result<gst::Pipeline> {
    let pipeline = gst::Pipeline::new();
    let src = video.device.create_element(None).context("device has no source element")?;
    let vtail = gst::parse::bin_from_description(&crate::specs::video_tail(f, slot), true)?;
    pipeline.add_many([&src, vtail.upcast_ref()])?;
    src.link(&vtail)?;
    match audio {
        Some(a) => {
            let asrc = a.device.create_element(None).context("audio device has no source element")?;
            let atail = gst::parse::bin_from_description(&crate::specs::audio_tail(slot), true)?;
            pipeline.add_many([&asrc, atail.upcast_ref()])?;
            asrc.link(&atail)?;
        }
        None => {
            let silence = gst::parse::bin_from_description(&crate::specs::silence(slot), false)?;
            pipeline.add(&silence)?;
        }
    }
    Ok(pipeline)
}

/// Splits "device:<video id>#audio=<audio id>".
pub fn parse_capture_spec(spec: &str) -> Option<(&str, Option<&str>)> {
    let rest = spec.strip_prefix("device:")?;
    Some(match rest.split_once("#audio=") {
        Some((v, a)) => (v, Some(a)),
        None => (rest, None),
    })
}

/// Programme audio (stereo) to an audio output device.
pub fn output_pipeline(dev: &Found) -> Result<gst::Pipeline> {
    let pipeline = gst::Pipeline::new();
    let head = gst::parse::bin_from_description(
        &format!("interaudiosrc channel=pgma {} ! {AUDIO_CAPS} ! audioconvert ! audioresample", crate::specs::INTER_AUDIO),
        true,
    )?;
    let sink = dev.device.create_element(None).context("device has no sink element")?;
    pipeline.add_many([head.upcast_ref(), &sink])?;
    head.link(&sink)?;
    Ok(pipeline)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_spec_with_and_without_audio() {
        assert_eq!(parse_capture_spec("device:FaceTime HD-Kamera"), Some(("FaceTime HD-Kamera", None)));
        assert_eq!(parse_capture_spec("device:Cam Link 4K#audio=Cam Link 4K"), Some(("Cam Link 4K", Some("Cam Link 4K"))));
        assert_eq!(parse_capture_spec("test:bars"), None);
    }

    #[test]
    fn matrix_picks_one_channel_for_both_sides() {
        assert_eq!(pick_matrix(4, 2), vec![vec![0.0, 0.0, 1.0, 0.0]]);
        assert_eq!(pick_matrix(1, 0), vec![vec![1.0]]);
    }
}
