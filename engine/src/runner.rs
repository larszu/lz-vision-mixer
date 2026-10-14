//! A pipeline with its own bus thread: reports when it runs, fails or ends,
//! loops files, and stops cleanly (with end-of-stream for recordings).

use anyhow::{Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

pub enum Event {
    Running,
    Error(String),
    Eos,
}

pub struct Runner {
    pub pipeline: gst::Pipeline,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    needs_eos: bool,
}

impl Runner {
    pub fn start(
        launch: &str,
        looping: bool,
        needs_eos: bool,
        on_event: impl Fn(Event) + Send + 'static,
    ) -> Result<Runner> {
        let pipeline = gst::parse::launch(launch)
            .with_context(|| format!("cannot build pipeline: {launch}"))?
            .downcast::<gst::Pipeline>()
            .map_err(|_| anyhow::anyhow!("not a pipeline"))?;
        Self::start_pipeline(pipeline, looping, needs_eos, on_event)
    }

    pub fn start_pipeline(
        pipeline: gst::Pipeline,
        looping: bool,
        needs_eos: bool,
        on_event: impl Fn(Event) + Send + 'static,
    ) -> Result<Runner> {
        let bus = pipeline.bus().context("pipeline without bus")?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop2 = stop.clone();
        let weak = pipeline.downgrade();
        let thread = std::thread::spawn(move || {
            let mut reported_running = false;
            while !stop2.load(Ordering::Relaxed) {
                let Some(msg) = bus.timed_pop(gst::ClockTime::from_mseconds(100)) else { continue };
                let Some(pipeline) = weak.upgrade() else { break };
                match msg.view() {
                    gst::MessageView::Error(e) => {
                        let mut text = e.error().to_string();
                        if let Some(d) = e.debug() {
                            // The first line of the debug text names the element; enough to act on.
                            if let Some(line) = d.lines().next() {
                                text = format!("{text} ({line})");
                            }
                        }
                        on_event(Event::Error(text));
                        break;
                    }
                    gst::MessageView::Eos(_) => {
                        if looping {
                            let _ = pipeline.seek_simple(
                                gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                                gst::ClockTime::ZERO,
                            );
                        } else {
                            on_event(Event::Eos);
                            break;
                        }
                    }
                    gst::MessageView::StateChanged(s) => {
                        if !reported_running
                            && msg.src() == Some(pipeline.upcast_ref::<gst::Object>())
                            && s.current() == gst::State::Playing
                        {
                            reported_running = true;
                            on_event(Event::Running);
                        }
                    }
                    _ => {}
                }
            }
        });
        pipeline.set_state(gst::State::Playing).context("pipeline refused to start")?;
        Ok(Runner { pipeline, stop, thread: Some(thread), needs_eos })
    }

    /// Stops the pipeline. Recordings get end-of-stream first so the muxer
    /// can write its index; waits at most five seconds for it.
    pub fn stop(mut self) {
        // Bus thread first, so it cannot swallow the end-of-stream we wait for.
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        if self.needs_eos {
            self.pipeline.send_event(gst::event::Eos::new());
            if let Some(bus) = self.pipeline.bus() {
                let _ = bus.timed_pop_filtered(
                    gst::ClockTime::from_seconds(5),
                    &[gst::MessageType::Eos, gst::MessageType::Error],
                );
            }
        }
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.pipeline.set_state(gst::State::Null);
        // The bus thread wakes every 100 ms and ends on its own.
    }
}
