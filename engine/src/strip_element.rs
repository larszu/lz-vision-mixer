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

    pub struct LzStrip {
        pub strip: Mutex<Strip>,
    }

    impl Default for LzStrip {
        fn default() -> Self {
            LzStrip { strip: Mutex::new(Strip::new(StripParams::default())) }
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
                    .field("channels", 1i32)
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

        fn transform_ip(&self, buf: &mut gst::BufferRef) -> Result<gst::FlowSuccess, gst::FlowError> {
            let mut map = buf.map_writable().map_err(|_| gst::FlowError::Error)?;
            let bytes = map.as_mut_slice();
            // SAFETY: f32 has no invalid bit patterns; align_to_mut only hands
            // out the correctly aligned middle part.
            let (head, samples, tail) = unsafe { bytes.align_to_mut::<f32>() };
            if !head.is_empty() || !tail.is_empty() {
                return Err(gst::FlowError::Error);
            }
            self.strip.lock().unwrap().process(samples);
            Ok(gst::FlowSuccess::Ok)
        }
    }
}

glib::wrapper! {
    pub struct LzStrip(ObjectSubclass<imp::LzStrip>) @extends gst_base::BaseTransform, gst::Element, gst::Object;
}

impl LzStrip {
    pub fn set_params(&self, p: StripParams) {
        self.imp().strip.lock().unwrap().set(p);
    }
}

pub fn register() -> Result<(), glib::BoolError> {
    gst::Element::register(None, "lzstrip", gst::Rank::NONE, LzStrip::static_type())
}
