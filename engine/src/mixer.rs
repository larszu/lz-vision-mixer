//! The mixer: one long-running main pipeline, input and output pipelines
//! that come and go, and the state the API shows.
//!
//! Main pipeline, per slot n (1..=8): intervideosrc in<n> → tee → five pads:
//!   programme compositor  sink_<n>        (the on-air layer)
//!   programme compositor  sink_<20+n>     (overlay 1, if this slot is chosen)
//!   programme compositor  sink_<30+n>     (overlay 2)
//!   multiview compositor  sink_<n>        (tile)
//!   multiview compositor  sink_<10+n>     (big preview, if this slot is on preview)
//! Programme sink_0 is black on top for fade to black; multiview sink_0 is the
//! programme. Switching is only ever a change of pad properties — nothing is
//! relinked while on air, and a pad with alpha 0 costs the compositor nothing.

use crate::easing::{ease, Easing};
use crate::format::Format;
use crate::layout::{self, Pad};
use crate::runner::{Event, Runner};
use crate::specs::{self, AUDIO_CAPS, VIDEO_FORMAT};
use crate::state::*;
use anyhow::{anyhow, bail, Context, Result};
use bytes::Bytes;
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::watch;

pub const MV_W: i32 = 1280;
pub const MV_H: i32 = 720;
const MV_FPS: i32 = 25;
const Z_PROGRAM: u32 = 10;
const Z_COMING: u32 = 11;
const Z_OVERLAY: u32 = 40;
const Z_FTB: u32 = 90;
const TICK: Duration = Duration::from_millis(4);
const RETRY: Duration = Duration::from_secs(3);

struct SlotRt {
    info: Slot,
    runner: Option<Runner>,
    /// Bumped whenever the source changes, so a stale retry or bus message
    /// from an old pipeline cannot touch the new one.
    epoch: u64,
}

struct OverlayRt {
    o: Overlay,
    /// 0 = off, 1 = in place; between while moving.
    level: f64,
    epoch: u64,
}

struct OutputRt {
    out: Output,
    runner: Option<Runner>,
}

struct Core {
    slots: Vec<SlotRt>,
    program: Option<usize>,
    preview: Option<usize>,
    transition: Transition,
    /// Running transition: generation, eased progress, and whether it is
    /// driven by the T-bar.
    trans_epoch: u64,
    in_transition: bool,
    trans_k: f64,
    tbar: f64,
    ftb: bool,
    ftb_level: f64,
    ftb_epoch: u64,
    overlays: Vec<OverlayRt>,
    outputs: Vec<OutputRt>,
    master: Master,
    next_output: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Saved {
    slots: Vec<SavedSlot>,
    transition: Option<Transition>,
    overlays: Vec<Overlay>,
    master: Option<Master>,
    program: Option<usize>,
    preview: Option<usize>,
}

#[derive(Serialize, Deserialize)]
struct SavedSlot {
    slot: usize,
    name: String,
    spec: Option<String>,
    audio: SlotAudio,
}

pub struct Mixer {
    pub format: Format,
    main: gst::Pipeline,
    pgm: gst::Element,
    mv: gst::Element,
    core: Mutex<Core>,
    caps: Capabilities,
    config: Option<PathBuf>,
    pub changed: watch::Sender<u64>,
    pub levels: watch::Sender<Levels>,
    pub jpeg: watch::Sender<Bytes>,
    me: Weak<Mixer>,
}

fn has(name: &str) -> bool {
    if name.starts_with("ndi") && !ndi_runtime() {
        return false;
    }
    gst::ElementFactory::find(name).is_some()
}

/// The NDI plugin registers its elements even without the NDI runtime and
/// only fails when started ("Failed loading NDI SDK"). Try once, up front.
fn ndi_runtime() -> bool {
    static OK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *OK.get_or_init(|| {
        let Ok(e) = gst::ElementFactory::make("ndisink").build() else { return false };
        let ok = e.set_state(gst::State::Ready).is_ok();
        let _ = e.set_state(gst::State::Null);
        ok
    })
}

fn main_launch(f: &Format) -> String {
    let caps = f.caps(VIDEO_FORMAT);
    let mv_rate = format!("videorate ! video/x-raw,framerate={MV_FPS}/1");
    let leaky = "queue leaky=downstream max-size-buffers=3";
    let mut s = format!(
        "compositor name=pgm background=black ! {caps} ! queue ! tee name=pgmt \
         pgmt. ! queue ! intervideosink channel=pgm sync=false \
         pgmt. ! {leaky} ! {mv_rate} ! mv.sink_0 \
         videotestsrc is-live=true pattern=black ! {caps} ! pgm.sink_0 \
         compositor name=mv background=black ! video/x-raw,format={VIDEO_FORMAT},width={MV_W},height={MV_H},framerate={MV_FPS}/1 ! queue ! tee name=mvt \
         mvt. ! queue ! intervideosink channel=mv sync=false \
         mvt. ! queue leaky=downstream max-size-buffers=1 ! videorate ! video/x-raw,framerate=15/1 ! jpegenc quality=70 ! appsink name=mvjpeg max-buffers=1 drop=true sync=false \
         audiomixer name=amix ! {AUDIO_CAPS} ! volume name=mvol ! level name=lvlm interval=100000000 ! queue ! interaudiosink channel=pgma sync=false \
         audiotestsrc is-live=true wave=silence ! {AUDIO_CAPS} ! amix.sink_0 "
    );
    for n in 1..=SLOTS {
        s.push_str(&format!(
            "intervideosrc channel=in{n} ! {caps} ! tee name=t{n} \
             t{n}. ! {leaky} ! pgm.sink_{n} \
             t{n}. ! {leaky} ! pgm.sink_{o1} \
             t{n}. ! {leaky} ! pgm.sink_{o2} \
             t{n}. ! {leaky} ! {mv_rate} ! mv.sink_{n} \
             t{n}. ! {leaky} ! {mv_rate} ! mv.sink_{pv} \
             interaudiosrc channel=ain{n} ! {AUDIO_CAPS} ! volume name=vol{n} ! level name=lvl{n} interval=100000000 ! queue ! amix.sink_{n} ",
            o1 = 20 + n,
            o2 = 30 + n,
            pv = 10 + n,
        ));
    }
    s
}

/// Multiview tile of a slot: two rows of four under preview and programme.
pub fn mv_tile(n: usize) -> (i32, i32, i32, i32) {
    let i = (n - 1) as i32;
    ((i % 4) * 320, 360 + (i / 4) * 180, 320, 180)
}

fn db(v: f64) -> f64 {
    if v.is_finite() { v.max(-90.0) } else { -90.0 }
}

impl Mixer {
    pub fn new(format: Format, config: Option<PathBuf>) -> Result<Arc<Mixer>> {
        let main = gst::parse::launch(&main_launch(&format))
            .context("cannot build the main pipeline")?
            .downcast::<gst::Pipeline>()
            .map_err(|_| anyhow!("main is not a pipeline"))?;
        let pgm = main.by_name("pgm").context("pgm")?;
        let mv = main.by_name("mv").context("mv")?;
        let caps = Capabilities {
            decklink: has("decklinkvideosrc"),
            ndi: has("ndisrc"),
            srt: has("srtsrc"),
            st2110: has("mtl_st20p_rx"),
            encoders: specs::encoders(has),
        };
        let slots = (1..=SLOTS)
            .map(|n| SlotRt {
                info: Slot {
                    slot: n,
                    name: format!("Input {n}"),
                    spec: None,
                    status: SlotStatus::Empty,
                    error: None,
                    audio: SlotAudio::default(),
                },
                runner: None,
                epoch: 0,
            })
            .collect();
        let overlays = (1..=OVERLAYS)
            .map(|i| OverlayRt {
                o: Overlay {
                    index: i,
                    slot: None,
                    on_air: false,
                    rect: if i == 1 { Rect::FULL } else { Rect { x: 0.68, y: 0.06, w: 0.28, h: 0.28 } },
                    transition: if i == 1 { OverlayTransition::Fade } else { OverlayTransition::FlyRight },
                    duration_ms: 500,
                },
                level: 0.0,
                epoch: 0,
            })
            .collect();
        let core = Core {
            slots,
            program: None,
            preview: None,
            transition: Transition::default(),
            trans_epoch: 0,
            in_transition: false,
            trans_k: 0.0,
            tbar: 0.0,
            ftb: false,
            ftb_level: 0.0,
            ftb_epoch: 0,
            overlays,
            outputs: Vec::new(),
            master: Master { volume: 1.0, muted: false },
            next_output: 1,
        };
        let (changed, _) = watch::channel(0u64);
        let (levels, _) = watch::channel(Levels { slots: BTreeMap::new(), master: [-90.0, -90.0] });
        let (jpeg, _) = watch::channel(Bytes::new());
        let mixer = Arc::new_cyclic(|me| Mixer {
            format,
            main,
            pgm,
            mv,
            core: Mutex::new(core),
            caps,
            config,
            changed,
            levels,
            jpeg,
            me: me.clone(),
        });
        mixer.init_pads();
        mixer.attach_jpeg()?;
        mixer.watch_main_bus();
        mixer.main.set_state(gst::State::Playing).context("main pipeline refused to start")?;
        mixer.restore();
        Ok(mixer)
    }

    // ── pads ────────────────────────────────────────────────────────────

    fn pad(&self, comp: &gst::Element, n: usize) -> Option<gst::Pad> {
        comp.static_pad(&format!("sink_{n}"))
    }

    fn set_pad(&self, comp: &gst::Element, n: usize, p: Pad, zorder: u32) {
        let Some(pad) = self.pad(comp, n) else { return };
        if p.alpha <= 0.0 {
            pad.set_property("alpha", 0.0f64);
            return;
        }
        pad.set_property("xpos", p.x);
        pad.set_property("ypos", p.y);
        pad.set_property("width", p.w.max(1));
        pad.set_property("height", p.h.max(1));
        pad.set_property("zorder", zorder);
        pad.set_property("alpha", p.alpha.min(1.0));
    }

    fn init_pads(&self) {
        let (w, h) = (self.format.width, self.format.height);
        for n in 1..=SLOTS {
            for p in [n, 20 + n, 30 + n] {
                self.set_pad(&self.pgm, p, Pad::HIDDEN, Z_PROGRAM);
            }
            let (x, y, tw, th) = mv_tile(n);
            self.set_pad(&self.mv, n, Pad { alpha: 1.0, x, y, w: tw, h: th }, 1);
            self.set_pad(&self.mv, 10 + n, Pad::HIDDEN, 1);
        }
        self.set_pad(&self.pgm, 0, Pad::HIDDEN, Z_FTB);
        if let Some(p) = self.pad(&self.pgm, 0) {
            p.set_property("zorder", Z_FTB);
        }
        self.set_pad(&self.mv, 0, Pad { alpha: 1.0, x: 640, y: 0, w: 640, h: 360 }, 1);
        let _ = (w, h);
    }

    /// Programme layers when no transition runs.
    fn apply_program(&self, c: &Core) {
        let (w, h) = (self.format.width, self.format.height);
        for n in 1..=SLOTS {
            let p = if c.program == Some(n) { Pad::full(w, h) } else { Pad::HIDDEN };
            self.set_pad(&self.pgm, n, p, Z_PROGRAM);
        }
    }

    fn apply_transition(&self, c: &Core, kind: TransitionKind, k: f64) {
        let (w, h) = (self.format.width, self.format.height);
        let (a, b) = layout::transition(kind, k, w, h);
        for n in 1..=SLOTS {
            if c.program == Some(n) {
                self.set_pad(&self.pgm, n, a, Z_PROGRAM);
            } else if c.preview == Some(n) {
                self.set_pad(&self.pgm, n, b, Z_COMING);
            } else {
                self.set_pad(&self.pgm, n, Pad::HIDDEN, Z_PROGRAM);
            }
        }
    }

    fn apply_preview(&self, c: &Core) {
        for n in 1..=SLOTS {
            let p = if c.preview == Some(n) {
                Pad { alpha: 1.0, x: 0, y: 0, w: 640, h: 360 }
            } else {
                Pad::HIDDEN
            };
            self.set_pad(&self.mv, 10 + n, p, 2);
        }
    }

    fn apply_overlay(&self, o: &OverlayRt) {
        let base = if o.o.index == 1 { 20 } else { 30 };
        let (w, h) = (self.format.width, self.format.height);
        for n in 1..=SLOTS {
            let p = if o.o.slot == Some(n) && o.level > 0.0 {
                layout::overlay(o.o.transition, o.level, o.o.rect, w, h)
            } else {
                Pad::HIDDEN
            };
            self.set_pad(&self.pgm, base + n, p, Z_OVERLAY + o.o.index as u32);
        }
    }

    fn apply_ftb(&self, c: &Core) {
        let p = Pad { alpha: c.ftb_level, ..Pad::full(self.format.width, self.format.height) };
        self.set_pad(&self.pgm, 0, p, Z_FTB);
    }

    fn apply_audio(&self, c: &Core) {
        let k = if c.in_transition { c.trans_k.clamp(0.0, 1.0) } else { 0.0 };
        for s in &c.slots {
            let n = s.info.slot;
            let a = &s.info.audio;
            let follow = if !a.afv {
                1.0
            } else if c.in_transition {
                (if c.program == Some(n) { 1.0 - k } else { 0.0 }) + (if c.preview == Some(n) { k } else { 0.0 })
            } else if c.program == Some(n) {
                1.0
            } else {
                0.0
            };
            let v = if a.muted { 0.0 } else { a.volume * follow };
            if let Some(e) = self.main.by_name(&format!("vol{n}")) {
                e.set_property("volume", v.clamp(0.0, 10.0));
            }
        }
        if let Some(e) = self.main.by_name("mvol") {
            let v = if c.master.muted { 0.0 } else { c.master.volume * (1.0 - c.ftb_level) };
            e.set_property("volume", v.clamp(0.0, 10.0));
        }
    }

    // ── state out ───────────────────────────────────────────────────────

    pub fn state(&self) -> State {
        let c = self.core.lock().unwrap();
        State {
            version: env!("CARGO_PKG_VERSION").to_string(),
            format: self.format.clone(),
            slots: c.slots.iter().map(|s| s.info.clone()).collect(),
            program: c.program,
            preview: c.preview,
            transition: c.transition.clone(),
            in_transition: c.in_transition,
            tbar: c.tbar,
            ftb: c.ftb,
            overlays: c.overlays.iter().map(|o| o.o.clone()).collect(),
            outputs: c.outputs.iter().map(|o| o.out.clone()).collect(),
            master: c.master.clone(),
            capabilities: self.caps.clone(),
        }
    }

    fn notify(&self) {
        self.changed.send_modify(|v| *v += 1);
    }

    // ── commands ────────────────────────────────────────────────────────

    pub fn handle(&self, cmd: Command) -> Result<()> {
        let persist = !matches!(
            cmd,
            Command::Cut | Command::Auto | Command::Tbar { .. } | Command::Ftb | Command::AddOutput { .. } | Command::RemoveOutput { .. }
        );
        match cmd {
            Command::SetInput { slot, spec, name } => self.set_input(slot, Some(spec), name)?,
            Command::ClearInput { slot } => self.set_input(slot, None, None)?,
            Command::RenameInput { slot, name } => {
                let mut c = self.core.lock().unwrap();
                c.slots.get_mut(slot_idx(slot)?).unwrap().info.name = name;
            }
            Command::Preview { slot } => {
                slot_idx(slot)?;
                let mut c = self.core.lock().unwrap();
                if c.in_transition {
                    bail!("a transition is running");
                }
                c.preview = Some(slot);
                self.apply_preview(&c);
            }
            Command::Program { slot } => {
                slot_idx(slot)?;
                let mut c = self.core.lock().unwrap();
                c.trans_epoch += 1;
                c.in_transition = false;
                c.tbar = 0.0;
                if c.preview == Some(slot) {
                    c.preview = c.program;
                }
                c.program = Some(slot);
                self.apply_program(&c);
                self.apply_preview(&c);
                self.apply_audio(&c);
            }
            Command::Cut => self.cut()?,
            Command::Auto => self.auto()?,
            Command::SetTransition { kind, duration_ms, easing } => {
                let mut c = self.core.lock().unwrap();
                if let Some(k) = kind {
                    c.transition.kind = k;
                }
                if let Some(d) = duration_ms {
                    c.transition.duration_ms = d.min(60_000);
                }
                if let Some(e) = easing {
                    c.transition.easing = e;
                }
            }
            Command::Tbar { value } => self.tbar(value)?,
            Command::Ftb => self.ftb(),
            Command::Overlay { index, slot, rect, transition, duration_ms } => {
                let i = overlay_idx(index)?;
                if let Some(Some(s)) = slot {
                    slot_idx(s)?;
                }
                let mut c = self.core.lock().unwrap();
                let o = &mut c.overlays[i];
                if let Some(s) = slot {
                    o.o.slot = s;
                }
                if let Some(r) = rect {
                    o.o.rect = Rect {
                        x: r.x.clamp(-1.0, 2.0),
                        y: r.y.clamp(-1.0, 2.0),
                        w: r.w.clamp(0.01, 2.0),
                        h: r.h.clamp(0.01, 2.0),
                    };
                }
                if let Some(t) = transition {
                    o.o.transition = t;
                }
                if let Some(d) = duration_ms {
                    o.o.duration_ms = d.min(60_000);
                }
                let snapshot = OverlayRt { o: o.o.clone(), level: o.level, epoch: o.epoch };
                self.apply_overlay(&snapshot);
            }
            Command::OverlayOn { index, on } => self.overlay_on(overlay_idx(index)?, on),
            Command::Audio { slot, volume, muted, afv } => {
                let i = slot_idx(slot)?;
                let mut c = self.core.lock().unwrap();
                let a = &mut c.slots[i].info.audio;
                if let Some(v) = volume {
                    a.volume = v.clamp(0.0, 2.0);
                }
                if let Some(m) = muted {
                    a.muted = m;
                }
                if let Some(f) = afv {
                    a.afv = f;
                }
                self.apply_audio(&c);
            }
            Command::Master { volume, muted } => {
                let mut c = self.core.lock().unwrap();
                if let Some(v) = volume {
                    c.master.volume = v.clamp(0.0, 2.0);
                }
                if let Some(m) = muted {
                    c.master.muted = m;
                }
                self.apply_audio(&c);
            }
            Command::AddOutput { spec } => self.add_output(spec)?,
            Command::RemoveOutput { id } => self.remove_output(&id)?,
        }
        self.notify();
        if persist {
            self.save();
        }
        Ok(())
    }

    fn set_input(&self, slot: usize, spec: Option<String>, name: Option<String>) -> Result<()> {
        let i = slot_idx(slot)?;
        let old = {
            let mut c = self.core.lock().unwrap();
            let s = &mut c.slots[i];
            s.epoch += 1;
            s.info.spec = spec.clone();
            s.info.error = None;
            s.info.status = if spec.is_some() { SlotStatus::Starting } else { SlotStatus::Empty };
            if spec.is_none() {
                s.info.name = format!("Input {slot}");
            }
            s.runner.take()
        };
        // Stopping can take a moment; never under the lock.
        if let Some(r) = old {
            r.stop();
        }
        if let Some(spec) = spec {
            self.start_input(slot, &spec, name);
        }
        Ok(())
    }

    fn start_input(&self, slot: usize, spec: &str, name: Option<String>) {
        let i = slot - 1;
        let epoch = self.core.lock().unwrap().slots[i].epoch;
        let plan = specs::input(spec, &self.format, slot, has);
        let mut c = self.core.lock().unwrap();
        if c.slots[i].epoch != epoch {
            return;
        }
        let plan = match plan {
            Ok(p) => p,
            Err(e) => {
                let s = &mut c.slots[i].info;
                s.status = SlotStatus::Error;
                s.error = Some(e.to_string());
                return;
            }
        };
        if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
            c.slots[i].info.name = n;
        } else if c.slots[i].info.name.starts_with("Input ") {
            c.slots[i].info.name = plan.name.clone();
        }
        let me = self.me.clone();
        let retry = plan.retry;
        let spec_owned = spec.to_string();
        match Runner::start(&plan.launch, plan.looping, false, move |ev| {
            if let Some(m) = me.upgrade() {
                m.input_event(slot, epoch, retry, &spec_owned, ev);
            }
        }) {
            Ok(r) => c.slots[i].runner = Some(r),
            Err(e) => {
                let s = &mut c.slots[i].info;
                s.status = SlotStatus::Error;
                s.error = Some(if spec.starts_with("decklink:") {
                    // The element only says it "failed to change state"; the usual cause is this.
                    match spec[9..].parse::<u32>() {
                        Ok(n) => format!("DeckLink {} (device {n}) not found: card or Desktop Video driver missing", n + 1),
                        Err(_) => format!("{e:#}"),
                    }
                } else {
                    format!("{e:#}")
                });
            }
        }
    }

    fn input_event(&self, slot: usize, epoch: u64, retry: bool, spec: &str, ev: Event) {
        let i = slot - 1;
        let old = {
            let mut c = self.core.lock().unwrap();
            if c.slots[i].epoch != epoch {
                return;
            }
            let s = &mut c.slots[i];
            match ev {
                Event::Running => {
                    s.info.status = SlotStatus::Running;
                    s.info.error = None;
                    None
                }
                Event::Error(e) => {
                    s.info.status = SlotStatus::Error;
                    s.info.error = Some(e);
                    s.runner.take()
                }
                Event::Eos => {
                    s.info.status = SlotStatus::Error;
                    s.info.error = Some("source ended".into());
                    s.runner.take()
                }
            }
        };
        self.notify();
        if let Some(r) = old {
            // The bus thread calls us; stop the pipeline from elsewhere.
            let me = self.me.clone();
            let spec = spec.to_string();
            std::thread::spawn(move || {
                r.stop();
                if !retry {
                    return;
                }
                std::thread::sleep(RETRY);
                let Some(m) = me.upgrade() else { return };
                {
                    let mut c = m.core.lock().unwrap();
                    if c.slots[i].epoch != epoch {
                        return;
                    }
                    c.slots[i].info.status = SlotStatus::Starting;
                }
                m.notify();
                m.start_input(slot, &spec, None);
                m.notify();
            });
        }
    }

    fn cut(&self) -> Result<()> {
        let mut c = self.core.lock().unwrap();
        let Some(next) = c.preview else { bail!("nothing on preview") };
        c.trans_epoch += 1;
        c.in_transition = false;
        c.tbar = 0.0;
        c.preview = c.program;
        c.program = Some(next);
        self.apply_program(&c);
        self.apply_preview(&c);
        self.apply_audio(&c);
        Ok(())
    }

    fn auto(&self) -> Result<()> {
        let (epoch, t) = {
            let mut c = self.core.lock().unwrap();
            if c.in_transition {
                return Ok(()); // like a hardware mixer: a second AUTO does not restart it
            }
            if c.preview.is_none() || c.preview == c.program {
                bail!("nothing new on preview");
            }
            if c.transition.kind == TransitionKind::Cut || c.transition.duration_ms == 0 || c.program.is_none() {
                drop(c);
                return self.cut();
            }
            c.trans_epoch += 1;
            c.in_transition = true;
            c.trans_k = 0.0;
            (c.trans_epoch, c.transition.clone())
        };
        let me = self.me.clone();
        std::thread::spawn(move || {
            let start = Instant::now();
            let dur = t.duration_ms as f64;
            // The UI follows the T-bar along; 20 updates a second are plenty.
            let mut last_notify = Instant::now();
            loop {
                let Some(m) = me.upgrade() else { return };
                let p = (start.elapsed().as_secs_f64() * 1000.0 / dur).min(1.0);
                let k = ease(t.easing, p);
                {
                    let mut c = m.core.lock().unwrap();
                    if c.trans_epoch != epoch {
                        return;
                    }
                    c.trans_k = k;
                    c.tbar = p;
                    m.apply_transition(&c, t.kind, k);
                    m.apply_audio(&c);
                }
                if p >= 1.0 {
                    m.finish_transition(epoch);
                    return;
                }
                if last_notify.elapsed() >= Duration::from_millis(50) {
                    last_notify = Instant::now();
                    m.notify();
                }
                drop(m);
                std::thread::sleep(TICK);
            }
        });
        Ok(())
    }

    fn finish_transition(&self, epoch: u64) {
        {
            let mut c = self.core.lock().unwrap();
            if c.trans_epoch != epoch {
                return;
            }
            c.in_transition = false;
            c.trans_k = 0.0;
            c.tbar = 0.0;
            let next = c.preview;
            c.preview = c.program;
            c.program = next;
            self.apply_program(&c);
            self.apply_preview(&c);
            self.apply_audio(&c);
        }
        self.notify();
    }

    /// The T-bar drives the selected transition by hand, without easing:
    /// the hand is the curve.
    fn tbar(&self, value: f64) -> Result<()> {
        let v = value.clamp(0.0, 1.0);
        let epoch = {
            let mut c = self.core.lock().unwrap();
            if c.preview.is_none() || c.preview == c.program || c.program.is_none() {
                bail!("nothing new on preview");
            }
            if !c.in_transition {
                if v <= 0.0 {
                    return Ok(());
                }
                c.trans_epoch += 1;
                c.in_transition = true;
            }
            let kind = match c.transition.kind {
                TransitionKind::Cut => TransitionKind::Mix,
                k => k,
            };
            c.tbar = v;
            c.trans_k = v;
            if v <= 0.0 {
                c.in_transition = false;
                c.trans_k = 0.0;
                self.apply_program(&c);
                self.apply_audio(&c);
                return Ok(());
            }
            self.apply_transition(&c, kind, v);
            self.apply_audio(&c);
            c.trans_epoch
        };
        if v >= 1.0 {
            self.finish_transition(epoch);
        }
        Ok(())
    }

    fn ftb(&self) {
        let (epoch, from, to, t) = {
            let mut c = self.core.lock().unwrap();
            c.ftb = !c.ftb;
            c.ftb_epoch += 1;
            (c.ftb_epoch, c.ftb_level, if c.ftb { 1.0 } else { 0.0 }, c.transition.clone())
        };
        let me = self.me.clone();
        animate(t.duration_ms, t.easing, move |k, _last| {
            let Some(m) = me.upgrade() else { return false };
            let mut c = m.core.lock().unwrap();
            if c.ftb_epoch != epoch {
                return false;
            }
            c.ftb_level = from + (to - from) * k.clamp(0.0, 1.0);
            m.apply_ftb(&c);
            m.apply_audio(&c);
            true
        });
    }

    fn overlay_on(&self, i: usize, on: bool) {
        let (epoch, from, easing, dur) = {
            let mut c = self.core.lock().unwrap();
            let easing = c.transition.easing;
            let o = &mut c.overlays[i];
            o.o.on_air = on;
            o.epoch += 1;
            let dur = if o.o.transition == OverlayTransition::Cut { 0 } else { o.o.duration_ms };
            (o.epoch, o.level, easing, dur)
        };
        let to = if on { 1.0 } else { 0.0 };
        let me = self.me.clone();
        animate(dur, easing, move |k, last| {
            let Some(m) = me.upgrade() else { return false };
            let mut c = m.core.lock().unwrap();
            let o = &mut c.overlays[i];
            if o.epoch != epoch {
                return false;
            }
            // Overshooting curves may carry the level past 1 while flying in;
            // the fly geometry follows, the end lands exactly.
            o.level = if last { to } else { from + (to - from) * k };
            let snap = OverlayRt { o: o.o.clone(), level: o.level, epoch };
            drop(c);
            m.apply_overlay(&snap);
            true
        });
    }

    fn add_output(&self, spec: String) -> Result<()> {
        let plan = specs::output(&spec, &self.format, has)?;
        let id = {
            let mut c = self.core.lock().unwrap();
            let id = format!("o{}", c.next_output);
            c.next_output += 1;
            c.outputs.push(OutputRt {
                out: Output { id: id.clone(), spec: spec.clone(), status: OutputStatus::Starting, error: None },
                runner: None,
            });
            id
        };
        let me = self.me.clone();
        let id2 = id.clone();
        let r = Runner::start(&plan.launch, false, plan.needs_eos, move |ev| {
            let Some(m) = me.upgrade() else { return };
            {
                let mut c = m.core.lock().unwrap();
                if let Some(o) = c.outputs.iter_mut().find(|o| o.out.id == id2) {
                    match ev {
                        Event::Running => {
                            o.out.status = OutputStatus::Running;
                            o.out.error = None;
                        }
                        Event::Error(e) => {
                            o.out.status = OutputStatus::Error;
                            o.out.error = Some(e);
                        }
                        Event::Eos => {
                            o.out.status = OutputStatus::Error;
                            o.out.error = Some("output ended".into());
                        }
                    }
                }
            }
            m.notify();
        });
        let mut c = self.core.lock().unwrap();
        let o = c.outputs.iter_mut().find(|o| o.out.id == id).unwrap();
        match r {
            Ok(r) => o.runner = Some(r),
            Err(e) => {
                o.out.status = OutputStatus::Error;
                o.out.error = Some(format!("{e:#}"));
            }
        }
        Ok(())
    }

    fn remove_output(&self, id: &str) -> Result<()> {
        let rt = {
            let mut c = self.core.lock().unwrap();
            let i = c.outputs.iter().position(|o| o.out.id == id).ok_or_else(|| anyhow!("no output {id}"))?;
            c.outputs.remove(i)
        };
        if let Some(r) = rt.runner {
            r.stop();
        }
        Ok(())
    }

    /// Stops every output cleanly (recordings get their index written).
    pub fn shutdown(&self) {
        let outs: Vec<OutputRt> = std::mem::take(&mut self.core.lock().unwrap().outputs);
        for o in outs {
            if let Some(r) = o.runner {
                r.stop();
            }
        }
        let _ = self.main.set_state(gst::State::Null);
    }

    // ── main bus, multiview JPEG ────────────────────────────────────────

    fn attach_jpeg(&self) -> Result<()> {
        let sink = self
            .main
            .by_name("mvjpeg")
            .context("mvjpeg")?
            .downcast::<gst_app::AppSink>()
            .map_err(|_| anyhow!("mvjpeg is not an appsink"))?;
        let tx = self.jpeg.clone();
        sink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_sample(move |s| {
                    let sample = s.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                    if let Some(buf) = sample.buffer() {
                        if let Ok(map) = buf.map_readable() {
                            tx.send_replace(Bytes::copy_from_slice(map.as_slice()));
                        }
                    }
                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );
        Ok(())
    }

    fn watch_main_bus(&self) {
        let Some(bus) = self.main.bus() else { return };
        let me = self.me.clone();
        std::thread::spawn(move || {
            let mut slots: BTreeMap<usize, [f64; 2]> = BTreeMap::new();
            let mut master = [-90.0, -90.0];
            let mut last_send = Instant::now();
            loop {
                let msg = bus.timed_pop(gst::ClockTime::from_mseconds(100));
                let Some(m) = me.upgrade() else { return };
                if let Some(msg) = msg {
                    match msg.view() {
                        gst::MessageView::Element(e) => {
                            if let (Some(s), Some(src)) = (e.structure(), msg.src()) {
                                if s.name() == "level" {
                                    let peak = peaks(s);
                                    let name = src.name();
                                    if name == "lvlm" {
                                        master = peak;
                                    } else if let Some(n) = name.strip_prefix("lvl").and_then(|n| n.parse().ok()) {
                                        slots.insert(n, peak);
                                    }
                                }
                            }
                        }
                        gst::MessageView::Error(e) => {
                            tracing::error!("main pipeline: {} {:?}", e.error(), e.debug());
                        }
                        gst::MessageView::Warning(w) => {
                            tracing::warn!("main pipeline: {}", w.error());
                        }
                        _ => {}
                    }
                }
                if last_send.elapsed() >= Duration::from_millis(100) {
                    last_send = Instant::now();
                    m.levels.send_replace(Levels { slots: slots.clone(), master });
                }
            }
        });
    }

    // ── persistence ─────────────────────────────────────────────────────

    fn save(&self) {
        let Some(path) = &self.config else { return };
        let saved = {
            let c = self.core.lock().unwrap();
            Saved {
                slots: c
                    .slots
                    .iter()
                    .map(|s| SavedSlot {
                        slot: s.info.slot,
                        name: s.info.name.clone(),
                        spec: s.info.spec.clone(),
                        audio: s.info.audio.clone(),
                    })
                    .collect(),
                transition: Some(c.transition.clone()),
                overlays: c.overlays.iter().map(|o| Overlay { on_air: false, ..o.o.clone() }).collect(),
                master: Some(c.master.clone()),
                program: c.program,
                preview: c.preview,
            }
        };
        let Ok(json) = serde_json::to_vec_pretty(&saved) else { return };
        let tmp = path.with_extension("json.tmp");
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }

    fn restore(&self) {
        let Some(path) = &self.config else { return };
        let Ok(bytes) = std::fs::read(path) else { return };
        let saved: Saved = match serde_json::from_slice(&bytes) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("ignoring unreadable config {}: {e}", path.display());
                return;
            }
        };
        let mut start = Vec::new();
        {
            let mut c = self.core.lock().unwrap();
            for s in saved.slots {
                let Some(rt) = c.slots.get_mut(s.slot.wrapping_sub(1)) else { continue };
                rt.info.name = s.name;
                rt.info.audio = s.audio;
                if let Some(spec) = s.spec {
                    rt.info.spec = Some(spec.clone());
                    rt.info.status = SlotStatus::Starting;
                    start.push((s.slot, spec));
                }
            }
            if let Some(t) = saved.transition {
                c.transition = t;
            }
            for o in saved.overlays {
                if let Some(rt) = c.overlays.get_mut(o.index.wrapping_sub(1)) {
                    rt.o = Overlay { on_air: false, ..o };
                }
            }
            if let Some(m) = saved.master {
                c.master = m;
            }
            c.program = saved.program.filter(|n| (1..=SLOTS).contains(n));
            c.preview = saved.preview.filter(|n| (1..=SLOTS).contains(n));
            self.apply_program(&c);
            self.apply_preview(&c);
            self.apply_audio(&c);
        }
        for (slot, spec) in start {
            let name = self.core.lock().unwrap().slots[slot - 1].info.name.clone();
            self.start_input(slot, &spec, Some(name));
        }
        self.notify();
    }
}

/// Runs `step(eased_k, last)` every tick for `duration_ms`; stops early when
/// `step` returns false (cancelled by a newer move).
fn animate(duration_ms: u64, easing: Easing, step: impl Fn(f64, bool) -> bool + Send + 'static) {
    std::thread::spawn(move || {
        let start = Instant::now();
        let dur = duration_ms.max(1) as f64;
        loop {
            let p = if duration_ms == 0 { 1.0 } else { (start.elapsed().as_secs_f64() * 1000.0 / dur).min(1.0) };
            let last = p >= 1.0;
            if !step(if last { 1.0 } else { ease(easing, p) }, last) || last {
                return;
            }
            std::thread::sleep(TICK);
        }
    });
}

fn slot_idx(slot: usize) -> Result<usize> {
    if (1..=SLOTS).contains(&slot) {
        Ok(slot - 1)
    } else {
        bail!("slot must be 1..{SLOTS}")
    }
}

fn overlay_idx(i: usize) -> Result<usize> {
    if (1..=OVERLAYS).contains(&i) {
        Ok(i - 1)
    } else {
        bail!("overlay must be 1..{OVERLAYS}")
    }
}

/// Peak per channel from a `level` message (first two channels).
fn peaks(s: &gst::StructureRef) -> [f64; 2] {
    let mut out = [-90.0, -90.0];
    if let Ok(arr) = s.get::<gst::glib::ValueArray>("peak") {
        for (i, v) in arr.iter().take(2).enumerate() {
            if let Ok(x) = v.get::<f64>() {
                out[i] = db(x);
            }
        }
        if arr.len() == 1 {
            out[1] = out[0];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiview_tiles_fill_the_lower_half() {
        assert_eq!(mv_tile(1), (0, 360, 320, 180));
        assert_eq!(mv_tile(4), (960, 360, 320, 180));
        assert_eq!(mv_tile(5), (0, 540, 320, 180));
        assert_eq!(mv_tile(8), (960, 540, 320, 180));
    }

    #[test]
    fn main_launch_names_every_pad() {
        let l = main_launch(&Format::parse("1080p50").unwrap());
        for n in 1..=SLOTS {
            for p in [format!("pgm.sink_{n} "), format!("pgm.sink_{} ", 20 + n), format!("mv.sink_{} ", 10 + n)] {
                assert!(l.contains(&p), "{p}");
            }
        }
    }
}
