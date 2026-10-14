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
use crate::devices;
use crate::specs::{self, AUDIO_CAPS, VIDEO_FORMAT};
use crate::vfa::Vfa;
use crate::state::*;
use anyhow::{anyhow, bail, Context, Result};
use bytes::Bytes;
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};

pub const MV_W: i32 = 1280;
pub const MV_H: i32 = 720;
const MV_FPS: i32 = 25;
const Z_PROGRAM: u32 = 10;
const Z_COMING: u32 = 11;
const Z_OVERLAY: u32 = 40;
const Z_FTB: u32 = 90;
const GFX_FTB: usize = 9;
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
    mics: Vec<MicRt>,
    devices: Vec<devices::Found>,
    vfa: Vfa,
    gfx: Vec<GraphicsLayer>,
    library: Vec<GraphicInfo>,
    renderer: Option<(u64, mpsc::UnboundedSender<String>)>,
    renderer_epoch: u64,
}

struct MicRt {
    info: Mic,
    runner: Option<Runner>,
    epoch: u64,
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
    #[serde(default)]
    mics: Vec<Mic>,
    #[serde(default)]
    vfa: Option<crate::vfa::VfaConfig>,
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
    gfx: gst::Element,
    mv: gst::Element,
    core: Mutex<Core>,
    /// Per graphics layer: a frame has arrived since the renderer connected.
    gfx_seen: [Arc<AtomicBool>; GFX_LAYERS],
    gfx_runners: Mutex<Vec<Option<Runner>>>,
    pub frame_ports: Vec<u16>,
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
    // Graphics carry per-pixel alpha; only a compositor that outputs a format
    // with alpha keeps it, so the graphics get a stage of their own in AYUV.
    let caps_a = f.caps("AYUV");
    let mv_rate = format!("videorate ! video/x-raw,framerate={MV_FPS}/1");
    let leaky = "queue leaky=downstream max-size-buffers=3";
    let lvl = "interval=100000000 post-messages=true";
    let mut s = format!(
        "compositor name=pgm background=black ! {caps} ! queue ! gfx.sink_0 \
         compositor name=gfx background=black ! {caps_a} ! videoconvert ! {caps} ! queue ! tee name=pgmt \
         pgmt. ! queue ! intervideosink channel=pgm sync=false \
         pgmt. ! {leaky} ! {mv_rate} ! mv.sink_0 \
         videotestsrc is-live=true pattern=black ! {caps} ! queue ! gfx.sink_{GFX_FTB} \
         compositor name=mv background=black ! video/x-raw,format={VIDEO_FORMAT},width={MV_W},height={MV_H},framerate={MV_FPS}/1 ! queue ! tee name=mvt \
         mvt. ! queue ! intervideosink channel=mv sync=false \
         mvt. ! queue leaky=downstream max-size-buffers=1 ! videorate ! video/x-raw,framerate=15/1 ! jpegenc quality=70 ! appsink name=mvjpeg max-buffers=1 drop=true sync=false \
         audiomixer name=amix ! {AUDIO_CAPS} ! volume name=mvol ! level name=lvlm {lvl} ! queue ! interaudiosink channel=pgma sync=false \
         audiotestsrc is-live=true wave=silence ! {AUDIO_CAPS} ! amix.sink_0 "
    );
    for l in 1..=GFX_LAYERS {
        // A layer holds its last frame for good: the renderer only sends
        // frames when the picture changes.
        s.push_str(&format!(
            "intervideosrc channel=gfx{l} timeout={} ! {caps_a} ! queue ! gfx.sink_{l} ",
            u64::MAX
        ));
    }
    for n in 1..=SLOTS {
        s.push_str(&format!(
            "intervideosrc channel=in{n} ! {caps} ! tee name=t{n} \
             t{n}. ! {leaky} ! pgm.sink_{n} \
             t{n}. ! {leaky} ! pgm.sink_{o1} \
             t{n}. ! {leaky} ! pgm.sink_{o2} \
             t{n}. ! {leaky} ! {mv_rate} ! mv.sink_{n} \
             t{n}. ! {leaky} ! {mv_rate} ! mv.sink_{pv} \
             interaudiosrc channel=ain{n} ! {AUDIO_CAPS} ! level name=pre{n} {lvl} ! volume name=vol{n} ! level name=lvl{n} {lvl} ! queue ! amix.sink_{n} ",
            o1 = 20 + n,
            o2 = 30 + n,
            pv = 10 + n,
        ));
    }
    for m in 1..=MICS {
        s.push_str(&format!(
            "interaudiosrc channel=mic{m} ! {AUDIO_CAPS} ! level name=micpre{m} {lvl} ! volume name=micvol{m} volume=0 ! level name=miclvl{m} {lvl} ! queue ! amix.sink_{a} ",
            a = 20 + m
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
    pub fn new(format: Format, config: Option<PathBuf>, frame_port: u16) -> Result<Arc<Mixer>> {
        let main = gst::parse::launch(&main_launch(&format))
            .context("cannot build the main pipeline")?
            .downcast::<gst::Pipeline>()
            .map_err(|_| anyhow!("main is not a pipeline"))?;
        let pgm = main.by_name("pgm").context("pgm")?;
        let mv = main.by_name("mv").context("mv")?;
        let gfx = main.by_name("gfx").context("gfx")?;
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
            mics: (1..=MICS)
                .map(|m| MicRt {
                    info: Mic {
                        mic: m,
                        name: format!("Mic {m}"),
                        device: None,
                        channel: 0,
                        status: SlotStatus::Empty,
                        error: None,
                        volume: 1.0,
                        muted: false,
                        in_program: true,
                    },
                    runner: None,
                    epoch: 0,
                })
                .collect(),
            devices: devices::list(),
            vfa: Vfa::default(),
            gfx: (1..=GFX_LAYERS)
                .map(|l| GraphicsLayer {
                    layer: l,
                    graphic_id: None,
                    data: serde_json::json!({}),
                    status: GfxStatus::Empty,
                    step: 0,
                    error: None,
                })
                .collect(),
            library: Vec::new(),
            renderer: None,
            renderer_epoch: 0,
        };
        let (changed, _) = watch::channel(0u64);
        let (levels, _) = watch::channel(Levels { slots: BTreeMap::new(), master: [-90.0, -90.0], mics: BTreeMap::new(), speech: BTreeMap::new() });
        let (jpeg, _) = watch::channel(Bytes::new());
        let mixer = Arc::new_cyclic(|me| Mixer {
            format,
            main,
            pgm,
            gfx,
            mv,
            core: Mutex::new(core),
            gfx_seen: std::array::from_fn(|_| Arc::new(AtomicBool::new(false))),
            gfx_runners: Mutex::new((0..GFX_LAYERS).map(|_| None).collect()),
            frame_ports: (0..GFX_LAYERS as u16).map(|i| frame_port + i).collect(),
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
        for l in 1..=GFX_LAYERS {
            mixer.start_frames(l);
        }
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
        self.set_pad(&self.gfx, GFX_FTB, Pad::HIDDEN, Z_FTB);
        if let Some(p) = self.pad(&self.gfx, GFX_FTB) {
            p.set_property("zorder", Z_FTB);
        }
        self.set_pad(&self.gfx, 0, Pad::full(w, h), 1);
        for l in 1..=GFX_LAYERS {
            self.set_pad(&self.gfx, l, Pad::HIDDEN, 10 + l as u32);
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
        self.set_pad(&self.gfx, GFX_FTB, p, Z_FTB);
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
        for m in &c.mics {
            let i = &m.info;
            let v = if i.muted || !i.in_program || i.device.is_none() { 0.0 } else { i.volume };
            if let Some(e) = self.main.by_name(&format!("micvol{}", i.mic)) {
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
            audio_devices: c.devices.iter().map(|d| d.info.clone()).collect(),
            mics: c.mics.iter().map(|m| m.info.clone()).collect(),
            vfa: VfaState { config: c.vfa.cfg.clone(), speaking: c.vfa.speaking() },
            graphics: Graphics {
                renderer_connected: c.renderer.is_some(),
                library: c.library.clone(),
                layers: c.gfx.clone(),
            },
        }
    }

    fn notify(&self) {
        self.changed.send_modify(|v| *v += 1);
    }

    // ── commands ────────────────────────────────────────────────────────

    pub fn handle(&self, cmd: Command) -> Result<()> {
        let persist = !matches!(
            cmd,
            Command::Cut
                | Command::Auto
                | Command::Tbar { .. }
                | Command::Ftb
                | Command::AddOutput { .. }
                | Command::RemoveOutput { .. }
                | Command::RefreshDevices
                | Command::GfxLoad { .. }
                | Command::GfxPlay { .. }
                | Command::GfxStop { .. }
                | Command::GfxUpdate { .. }
                | Command::GfxCustom { .. }
                | Command::GfxClear { .. }
                | Command::GfxRescan
        );
        if matches!(cmd, Command::Program { .. } | Command::Cut | Command::Auto | Command::Tbar { .. }) {
            self.core.lock().unwrap().vfa.manual(now_ms());
        }
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
            Command::SetMic { mic, device, channel, name } => self.set_mic(mic, Some((device, channel)), name)?,
            Command::ClearMic { mic } => self.set_mic(mic, None, None)?,
            Command::RenameMic { mic, name } => {
                let i = mic_idx(mic)?;
                self.core.lock().unwrap().mics[i].info.name = name;
            }
            Command::MicAudio { mic, volume, muted, in_program } => {
                let i = mic_idx(mic)?;
                let mut c = self.core.lock().unwrap();
                let m = &mut c.mics[i].info;
                if let Some(v) = volume {
                    m.volume = v.clamp(0.0, 2.0);
                }
                if let Some(x) = muted {
                    m.muted = x;
                }
                if let Some(x) = in_program {
                    m.in_program = x;
                }
                self.apply_audio(&c);
            }
            Command::RefreshDevices => {
                let found = devices::list();
                self.core.lock().unwrap().devices = found;
            }
            Command::SetVfa {
                enabled,
                rules,
                wide_slot,
                threshold_db,
                dominance_db,
                attack_ms,
                min_shot_ms,
                silence_ms,
                max_shot_ms,
                wide_break_ms,
                transition,
            } => {
                let mut c = self.core.lock().unwrap();
                let v = &mut c.vfa;
                let cfg = &mut v.cfg;
                if let Some(r) = rules {
                    for rule in &r {
                        slot_idx(rule.camera)?;
                        let ok = rule
                            .source
                            .split_once(':')
                            .and_then(|(k, n)| n.parse::<usize>().ok().map(|n| (k, n)))
                            .is_some_and(|(k, n)| match k {
                                "slot" => (1..=SLOTS).contains(&n),
                                "mic" => (1..=MICS).contains(&n),
                                _ => false,
                            });
                        if !ok {
                            bail!("unknown audio source '{}'", rule.source);
                        }
                    }
                    cfg.rules = r;
                }
                if let Some(w) = wide_slot {
                    if let Some(n) = w {
                        slot_idx(n)?;
                    }
                    cfg.wide_slot = w;
                }
                if let Some(x) = threshold_db {
                    cfg.threshold_db = x.clamp(-90.0, 0.0);
                }
                if let Some(x) = dominance_db {
                    cfg.dominance_db = x.clamp(0.0, 40.0);
                }
                if let Some(x) = attack_ms {
                    cfg.attack_ms = x.min(10_000);
                }
                if let Some(x) = min_shot_ms {
                    cfg.min_shot_ms = x.min(120_000);
                }
                if let Some(x) = silence_ms {
                    cfg.silence_ms = x.min(120_000);
                }
                if let Some(x) = max_shot_ms {
                    cfg.max_shot_ms = x.min(600_000);
                }
                if let Some(x) = wide_break_ms {
                    cfg.wide_break_ms = x.min(120_000);
                }
                if let Some(x) = transition {
                    cfg.transition = x;
                }
                if let Some(e) = enabled {
                    if e && !cfg.enabled {
                        v.reset();
                    }
                    v.cfg.enabled = e;
                }
            }
            Command::GfxLoad { layer, graphic_id, data } => {
                let i = gfx_idx(layer)?;
                let data = data.unwrap_or_else(|| serde_json::json!({}));
                self.to_renderer(serde_json::json!({"type":"load","layer":layer,"graphicId":graphic_id,"data":data}))?;
                let mut c = self.core.lock().unwrap();
                let l = &mut c.gfx[i];
                l.graphic_id = Some(graphic_id);
                l.data = data;
                l.status = GfxStatus::Loading;
                l.error = None;
                l.step = 0;
            }
            Command::GfxPlay { layer, delta, goto, skip_animation } => {
                gfx_idx(layer)?;
                let mut params = serde_json::Map::new();
                if let Some(d) = delta {
                    params.insert("delta".into(), d.into());
                }
                if let Some(g) = goto {
                    params.insert("goto".into(), g.into());
                }
                if let Some(s) = skip_animation {
                    params.insert("skipAnimation".into(), s.into());
                }
                self.to_renderer(serde_json::json!({"type":"play","layer":layer,"params":params}))?;
            }
            Command::GfxStop { layer, skip_animation } => {
                gfx_idx(layer)?;
                let params = match skip_animation {
                    Some(s) => serde_json::json!({"skipAnimation": s}),
                    None => serde_json::json!({}),
                };
                self.to_renderer(serde_json::json!({"type":"stop","layer":layer,"params":params}))?;
            }
            Command::GfxUpdate { layer, data } => {
                let i = gfx_idx(layer)?;
                self.to_renderer(serde_json::json!({"type":"update","layer":layer,"data":data}))?;
                self.core.lock().unwrap().gfx[i].data = data;
            }
            Command::GfxCustom { layer, id, payload } => {
                gfx_idx(layer)?;
                let payload = payload.unwrap_or_else(|| serde_json::json!({}));
                self.to_renderer(serde_json::json!({"type":"custom","layer":layer,"id":id,"payload":payload}))?;
            }
            Command::GfxClear { layer } => {
                let i = gfx_idx(layer)?;
                self.to_renderer(serde_json::json!({"type":"clear","layer":layer}))?;
                let mut c = self.core.lock().unwrap();
                let l = &mut c.gfx[i];
                l.graphic_id = None;
                l.status = GfxStatus::Empty;
                l.step = 0;
                l.error = None;
            }
            Command::GfxRescan => self.to_renderer(serde_json::json!({"type":"rescan"}))?,
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
            let mut mics: BTreeMap<usize, f64> = BTreeMap::new();
            let mut speech: BTreeMap<String, f64> = BTreeMap::new();
            let mut last_send = Instant::now();
            loop {
                let msg = bus.timed_pop(gst::ClockTime::from_mseconds(100));
                let Some(m) = me.upgrade() else { return };
                if let Some(msg) = msg {
                    match msg.view() {
                        gst::MessageView::Element(e) => {
                            if let (Some(s), Some(src)) = (e.structure(), msg.src()) {
                                if s.name() == "level" {
                                    let name = src.name();
                                    let num = |p: &str| name.strip_prefix(p).and_then(|n| n.parse::<usize>().ok());
                                    if name == "lvlm" {
                                        master = peaks(s);
                                    } else if let Some(n) = num("lvl") {
                                        slots.insert(n, peaks(s));
                                    } else if let Some(n) = num("pre") {
                                        let r = field2(s, "rms");
                                        speech.insert(format!("slot:{n}"), r[0].max(r[1]));
                                    } else if let Some(n) = num("micpre") {
                                        speech.insert(format!("mic:{n}"), field2(s, "rms")[0]);
                                    } else if let Some(n) = num("miclvl") {
                                        mics.insert(n, peaks(s)[0]);
                                    }
                                }
                            }
                        }
                        gst::MessageView::Error(e) => {
                            tracing::error!("main pipeline: {} {:?}", e.error(), e.debug());
                        }
                        gst::MessageView::Warning(w) => {
                            tracing::warn!(
                                "main pipeline: {} ({}: {:?})",
                                w.error(),
                                msg.src().map(|s| s.path_string().to_string()).unwrap_or_default(),
                                w.debug()
                            );
                        }
                        _ => {}
                    }
                }
                if last_send.elapsed() >= Duration::from_millis(100) {
                    last_send = Instant::now();
                    m.levels.send_replace(Levels {
                        slots: slots.clone(),
                        master,
                        mics: mics.clone(),
                        speech: speech.clone(),
                    });
                    m.vfa_tick(&speech);
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
                mics: c.mics.iter().map(|m| m.info.clone()).collect(),
                vfa: Some(c.vfa.cfg.clone()),
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
            for m in saved.mics {
                if let Some(rt) = c.mics.get_mut(m.mic.wrapping_sub(1)) {
                    rt.info = Mic { status: SlotStatus::Empty, error: None, ..m };
                }
            }
            if let Some(v) = saved.vfa {
                // Never come back cutting on its own: the operator switches it on.
                c.vfa = Vfa::new(crate::vfa::VfaConfig { enabled: false, ..v });
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
        let mics: Vec<(usize, String, u32)> = self
            .core
            .lock()
            .unwrap()
            .mics
            .iter()
            .filter_map(|m| m.info.device.clone().map(|d| (m.info.mic, d, m.info.channel)))
            .collect();
        for (mic, dev, ch) in mics {
            let _ = self.set_mic(mic, Some((dev, ch)), None);
        }
        self.notify();
    }
}

impl Mixer {
    // ── microphones ─────────────────────────────────────────────────────

    fn set_mic(&self, mic: usize, source: Option<(String, u32)>, name: Option<String>) -> Result<()> {
        let i = mic_idx(mic)?;
        let (old, epoch) = {
            let mut c = self.core.lock().unwrap();
            let m = &mut c.mics[i];
            m.epoch += 1;
            m.info.error = None;
            if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
                m.info.name = n;
            }
            match &source {
                Some((dev, ch)) => {
                    m.info.device = Some(dev.clone());
                    m.info.channel = *ch;
                    m.info.status = SlotStatus::Starting;
                }
                None => {
                    m.info.device = None;
                    m.info.status = SlotStatus::Empty;
                }
            }
            let epoch = m.epoch;
            let old = m.runner.take();
            self.apply_audio(&c);
            (old, epoch)
        };
        if let Some(r) = old {
            r.stop();
        }
        let Some((dev, ch)) = source else { return Ok(()) };
        let mut c = self.core.lock().unwrap();
        if !c.devices.iter().any(|d| d.info.id == dev) {
            // Plugged in after start: look again once.
            c.devices = devices::list();
        }
        let built = match c.devices.iter().find(|d| d.info.id == dev) {
            Some(d) => devices::mic_pipeline(d, ch, mic),
            None => Err(anyhow!("audio device '{dev}' not found")),
        };
        let me = self.me.clone();
        let result = built.and_then(|p| {
            Runner::start_pipeline(p, false, false, move |ev| {
                let Some(m) = me.upgrade() else { return };
                {
                    let mut c = m.core.lock().unwrap();
                    let rt = &mut c.mics[i];
                    if rt.epoch != epoch {
                        return;
                    }
                    match ev {
                        Event::Running => {
                            rt.info.status = SlotStatus::Running;
                            rt.info.error = None;
                        }
                        Event::Error(e) => {
                            rt.info.status = SlotStatus::Error;
                            rt.info.error = Some(e);
                        }
                        Event::Eos => {
                            rt.info.status = SlotStatus::Error;
                            rt.info.error = Some("device stopped".into());
                        }
                    }
                }
                m.notify();
            })
        });
        let rt = &mut c.mics[i];
        match result {
            Ok(r) => rt.runner = Some(r),
            Err(e) => {
                rt.info.status = SlotStatus::Error;
                rt.info.error = Some(format!("{e:#}"));
            }
        }
        Ok(())
    }

    // ── video follows audio ─────────────────────────────────────────────

    fn vfa_tick(&self, speech: &BTreeMap<String, f64>) {
        let (cam, transition, changed) = {
            let mut c = self.core.lock().unwrap();
            if !c.vfa.cfg.enabled || c.in_transition {
                return;
            }
            let before = c.vfa.speaking();
            let cam = c.vfa.tick(now_ms(), speech);
            (cam, c.vfa.cfg.transition, before != c.vfa.speaking())
        };
        if let Some(cam) = cam {
            let program = self.core.lock().unwrap().program;
            if program != Some(cam) {
                let r = match transition {
                    crate::vfa::VfaTransition::Cut => self.take(cam),
                    crate::vfa::VfaTransition::Auto => {
                        {
                            let mut c = self.core.lock().unwrap();
                            c.preview = Some(cam);
                            self.apply_preview(&c);
                        }
                        self.auto()
                    }
                };
                if let Err(e) = r {
                    tracing::warn!("video follows audio: {e:#}");
                }
            }
        }
        if cam.is_some() || changed {
            self.notify();
        }
    }

    /// Straight to programme without touching what the operator has on preview.
    fn take(&self, slot: usize) -> Result<()> {
        slot_idx(slot)?;
        let mut c = self.core.lock().unwrap();
        c.trans_epoch += 1;
        c.in_transition = false;
        c.tbar = 0.0;
        c.program = Some(slot);
        self.apply_program(&c);
        self.apply_audio(&c);
        Ok(())
    }

    // ── graphics renderer ───────────────────────────────────────────────

    fn to_renderer(&self, msg: serde_json::Value) -> Result<()> {
        let c = self.core.lock().unwrap();
        let Some((_, tx)) = &c.renderer else { bail!("graphics renderer not connected") };
        tx.send(msg.to_string()).map_err(|_| anyhow!("graphics renderer not connected"))
    }

    /// A renderer connected. The newest one wins; returns its id.
    pub fn renderer_attach(&self, tx: mpsc::UnboundedSender<String>) -> u64 {
        let hello = serde_json::json!({
            "type": "hello",
            "format": { "width": self.format.width, "height": self.format.height, "fps": self.format.fps },
            "layers": GFX_LAYERS,
            "framePorts": self.frame_ports,
        });
        let _ = tx.send(hello.to_string());
        let id = {
            let mut c = self.core.lock().unwrap();
            c.renderer_epoch += 1;
            let id = c.renderer_epoch;
            c.renderer = Some((id, tx));
            id
        };
        self.notify();
        id
    }

    pub fn renderer_detach(&self, id: u64) {
        {
            let mut c = self.core.lock().unwrap();
            if c.renderer.as_ref().map(|r| r.0) != Some(id) {
                return;
            }
            c.renderer = None;
            for l in &mut c.gfx {
                l.status = GfxStatus::Empty;
                l.graphic_id = None;
                l.step = 0;
            }
        }
        // Without a renderer the held frames are stale: hide the layers.
        for l in 1..=GFX_LAYERS {
            self.gfx_seen[l - 1].store(false, Ordering::Relaxed);
            self.set_pad(&self.gfx, l, Pad::HIDDEN, 10 + l as u32);
        }
        self.notify();
    }

    pub fn renderer_message(&self, text: &str) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return };
        let mut c = self.core.lock().unwrap();
        match v.get("type").and_then(|t| t.as_str()) {
            Some("library") => {
                if let Some(g) = v.get("graphics") {
                    c.library = serde_json::from_value(g.clone()).unwrap_or_default();
                }
            }
            Some("layer") => {
                let Some(i) = v.get("layer").and_then(|l| l.as_u64()).and_then(|l| gfx_idx(l as usize).ok()) else {
                    return;
                };
                let l = &mut c.gfx[i];
                if let Some(id) = v.get("graphicId") {
                    l.graphic_id = id.as_str().map(String::from);
                }
                if let Some(st) = v.get("status").and_then(|s| serde_json::from_value(s.clone()).ok()) {
                    l.status = st;
                }
                if let Some(step) = v.get("step").and_then(|s| s.as_i64()) {
                    l.step = step;
                }
                l.error = v.get("error").and_then(|e| e.as_str()).map(String::from);
            }
            _ => return,
        }
        drop(c);
        self.notify();
    }

    /// Frame input for a graphics layer: the renderer streams raw BGRA over
    /// TCP. When it disconnects the source ends, and we listen again.
    fn start_frames(&self, layer: usize) {
        let f = &self.format;
        let port = self.frame_ports[layer - 1];
        let launch = format!(
            "tcpserversrc host=127.0.0.1 port={port} ! rawvideoparse format=bgra width={} height={} framerate={}/{} ! videoconvert ! {} ! intervideosink name=sink channel=gfx{layer} sync=false async=false",
            f.width,
            f.height,
            f.fps_n,
            f.fps_d,
            f.caps("AYUV")
        );
        let me = self.me.clone();
        let started = Runner::start(&launch, false, false, move |ev| {
            if matches!(ev, Event::Eos | Event::Error(_)) {
                let me = me.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(200));
                    if let Some(m) = me.upgrade() {
                        m.start_frames(layer);
                    }
                });
            }
        });
        match started {
            Ok(r) => {
                // First frame since the renderer connected: show the layer.
                if let (Some(sink), Some(pad)) = (r.pipeline.by_name("sink"), self.pad(&self.gfx, layer)) {
                    let seen = self.gfx_seen[layer - 1].clone();
                    let (w, h) = (f.width, f.height);
                    if let Some(sinkpad) = sink.static_pad("sink") {
                        sinkpad.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
                            if !seen.swap(true, Ordering::Relaxed) {
                                pad.set_property("xpos", 0);
                                pad.set_property("ypos", 0);
                                pad.set_property("width", w);
                                pad.set_property("height", h);
                                pad.set_property("alpha", 1.0f64);
                            }
                            gst::PadProbeReturn::Ok
                        });
                    }
                }
                let old = std::mem::replace(&mut self.gfx_runners.lock().unwrap()[layer - 1], Some(r));
                // The old runner has ended already; dropping it just cleans up.
                drop(old);
            }
            Err(e) => tracing::error!("graphics layer {layer}: cannot listen on port {port}: {e:#}"),
        }
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

fn mic_idx(m: usize) -> Result<usize> {
    if (1..=MICS).contains(&m) {
        Ok(m - 1)
    } else {
        bail!("mic must be 1..{MICS}")
    }
}

fn gfx_idx(l: usize) -> Result<usize> {
    if (1..=GFX_LAYERS).contains(&l) {
        Ok(l - 1)
    } else {
        bail!("graphics layer must be 1..{GFX_LAYERS}")
    }
}

/// Milliseconds since the engine started; the clock of video follows audio.
fn now_ms() -> u64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
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
    field2(s, "peak")
}

fn field2(s: &gst::StructureRef, field: &str) -> [f64; 2] {
    let mut out = [-90.0, -90.0];
    if let Ok(arr) = s.get::<gst::glib::ValueArray>(field) {
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
