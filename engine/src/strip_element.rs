//! `lzstrip`: the channel strip of dsp.rs as a GStreamer element (mono F32,
//! 48 kHz, in place). Registered inside this program only.

use crate::dsp::{Strip, StripParams};
use gstreamer as gst;
use gstreamer::glib;
use gstreamer::prelude::*;
use gstreamer::subclass::prelude::*;
use gstreamer_base as gst_base;
use gstreamer_base::subclass::prelude::*;
use std::sync::{LazyLock, Mutex};

mod imp {
    use super::*;

    /// One strip per channel (mono mics, stereo line inputs).
    pub struct LzStrip {
        pub strips: Mutex<Vec<Strip>>,
        pub params: Mutex<StripParams>,
    }

    impl Default for LzStrip {
        fn default() -> Self {
            LzStrip { strips: Mutex::new(vec![Strip::new(StripParams::default())]), params: Mutex::new(StripParams::default()) }
        }
    }

    #[glib::object_subclass]
    impl ObjectSubclass for LzStrip {
        const NAME: &'static str = "LzVisionMixerStrip";
        type Type = super::LzStrip;
        type ParentType = gst_base::BaseTransform;
    }

    impl ObjectImpl for LzStrip {}
    impl GstObjectImpl for LzStrip {}

    impl ElementImpl for LzStrip {
        fn metadata() -> Option<&'static gst::subclass::ElementMetadata> {
            static META: LazyLock<gst::subclass::ElementMetadata> = LazyLock::new(|| {
                gst::subclass::ElementMetadata::new(
                    "LZ channel strip",
                    "Filter/Effect/Audio",
                    "High-pass, gate, compressor and makeup gain for a microphone",
                    "Lars Zumpe",
                )
            });
            Some(&*META)
        }

        fn pad_templates() -> &'static [gst::PadTemplate] {
            static TEMPLATES: LazyLock<Vec<gst::PadTemplate>> = LazyLock::new(|| {
                let caps = gst::Caps::builder("audio/x-raw")
                    .field("format", "F32LE")
                    .field("rate", 48_000i32)
                    .field("channels", gst::IntRange::new(1, 2))
                    .field("layout", "interleaved")
                    .build();
                vec![
                    gst::PadTemplate::new("src", gst::PadDirection::Src, gst::PadPresence::Always, &caps).unwrap(),
                    gst::PadTemplate::new("sink", gst::PadDirection::Sink, gst::PadPresence::Always, &caps).unwrap(),
                ]
            });
            TEMPLATES.as_ref()
        }
    }

    impl BaseTransformImpl for LzStrip {
        const MODE: gst_base::subclass::BaseTransformMode = gst_base::subclass::BaseTransformMode::AlwaysInPlace;
        const PASSTHROUGH_ON_SAME_CAPS: bool = false;
        const TRANSFORM_IP_ON_PASSTHROUGH: bool = false;

        fn set_caps(&self, incaps: &gst::Caps, _outcaps: &gst::Caps) -> Result<(), gst::LoggableError> {
            let channels = incaps
                .structure(0)
                .and_then(|s| s.get::<i32>("channels").ok())
                .unwrap_or(1)
                .max(1) as usize;
            let p = self.params.lock().unwrap().clone();
            *self.strips.lock().unwrap() = (0..channels).map(|_| Strip::new(p.clone())).collect();
            Ok(())
        }

        fn transform_ip(&self, buf: &mut gst::BufferRef) -> Result<gst::FlowSuccess, gst::FlowError> {
            let mut map = buf.map_writable().map_err(|_| gst::FlowError::Error)?;
            let bytes = map.as_mut_slice();
            // SAFETY: f32 has no invalid bit patterns; align_to_mut only hands
            // out the correctly aligned middle part.
            let (head, samples, tail) = unsafe { bytes.align_to_mut::<f32>() };
            if !head.is_empty() || !tail.is_empty() {
                return Err(gst::FlowError::Error);
            }
            let mut strips = self.strips.lock().unwrap();
            let n = strips.len();
            if n == 1 {
                strips[0].process(samples);
            } else {
                for (c, st) in strips.iter_mut().enumerate() {
                    st.process_channel(samples, c, n);
                }
            }
            Ok(gst::FlowSuccess::Ok)
        }
    }
}

glib::wrapper! {
    pub struct LzStrip(ObjectSubclass<imp::LzStrip>) @extends gst_base::BaseTransform, gst::Element, gst::Object;
}

impl LzStrip {
    pub fn set_params(&self, p: StripParams) {
        *self.imp().params.lock().unwrap() = p.clone();
        for st in self.imp().strips.lock().unwrap().iter_mut() {
            st.set(p.clone());
        }
    }
}

pub fn register() -> Result<(), glib::BoolError> {
    gst::Element::register(None, "lzstrip", gst::Rank::NONE, LzStrip::static_type())
}
