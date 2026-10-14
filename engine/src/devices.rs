//! Audio interfaces for the microphones: listing them and capturing one
//! channel of one device into a mic bus.
//!
//! GStreamer's device monitor covers CoreAudio, WASAPI and PulseAudio /
//! PipeWire alike and hands out a ready source element per device, so there
//! is no platform code here.

use crate::specs::AUDIO_CAPS;
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
    let monitor = gst::DeviceMonitor::new();
    monitor.add_filter(Some("Audio/Source"), None);
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

/// Two rows (left, right) that both take `channel` of `inputs` channels.
pub fn pick_matrix(inputs: u32, channel: u32) -> Vec<Vec<f32>> {
    let row: Vec<f32> = (0..inputs).map(|i| if i == channel { 1.0 } else { 0.0 }).collect();
    vec![row.clone(), row]
}

/// Pipeline: device → force its channel count → pick one channel onto both
/// sides → mic bus `mic<n>`.
pub fn mic_pipeline(dev: &Found, channel: u32, mic: usize) -> Result<gst::Pipeline> {
    let ch = dev.info.channels.max(1);
    if channel >= ch {
        return Err(anyhow!("{} has {} channels; channel {} does not exist", dev.info.name, ch, channel + 1));
    }
    let pipeline = gst::Pipeline::new();
    let src = dev.device.create_element(None).context("device has no source element")?;
    let rest = gst::parse::bin_from_description(
        &format!(
            "audioconvert ! audio/x-raw,channels={ch} ! audioconvert name=pick ! audioresample ! {AUDIO_CAPS} ! queue ! interaudiosink channel=mic{mic} async=false"
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
    pipeline.add_many([&src, rest.upcast_ref()])?;
    src.link(&rest)?;
    Ok(pipeline)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix_picks_one_channel_for_both_sides() {
        assert_eq!(pick_matrix(4, 2), vec![vec![0.0, 0.0, 1.0, 0.0], vec![0.0, 0.0, 1.0, 0.0]]);
        assert_eq!(pick_matrix(1, 0), vec![vec![1.0], vec![1.0]]);
    }
}
