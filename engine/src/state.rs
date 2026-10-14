//! State and commands as they travel over the API (see docs/api.md).

use crate::easing::Easing;
use crate::format::Format;
use crate::vfa::{VfaConfig, VfaRule, VfaTransition};
use serde::{Deserialize, Serialize};

pub const SLOTS: usize = 8;
pub const OVERLAYS: usize = 2;
pub const MICS: usize = 8;
pub const GFX_LAYERS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlotStatus {
    Empty,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotAudio {
    pub volume: f64,
    pub muted: bool,
    pub afv: bool,
}

impl Default for SlotAudio {
    fn default() -> Self {
        SlotAudio { volume: 1.0, muted: false, afv: true }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Slot {
    pub slot: usize,
    pub name: String,
    pub spec: Option<String>,
    pub status: SlotStatus,
    pub error: Option<String>,
    pub audio: SlotAudio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransitionKind {
    Cut,
    Mix,
    Dip,
    PushLeft,
    PushRight,
    SlideLeft,
    SlideRight,
    Zoom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub kind: TransitionKind,
    pub duration_ms: u64,
    pub easing: Easing,
}

impl Default for Transition {
    fn default() -> Self {
        Transition { kind: TransitionKind::Mix, duration_ms: 1000, easing: Easing::default() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub const FULL: Rect = Rect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverlayTransition {
    Cut,
    Fade,
    FlyLeft,
    FlyRight,
    FlyTop,
    FlyBottom,
    Zoom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub index: usize,
    pub slot: Option<usize>,
    pub on_air: bool,
    pub rect: Rect,
    pub transition: OverlayTransition,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStatus {
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct Output {
    pub id: String,
    pub spec: String,
    pub status: OutputStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Master {
    pub volume: f64,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Capabilities {
    pub decklink: bool,
    pub ndi: bool,
    pub srt: bool,
    pub st2110: bool,
    pub encoders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub version: String,
    pub format: Format,
    pub slots: Vec<Slot>,
    pub program: Option<usize>,
    pub preview: Option<usize>,
    pub transition: Transition,
    pub in_transition: bool,
    pub tbar: f64,
    pub ftb: bool,
    pub overlays: Vec<Overlay>,
    pub outputs: Vec<Output>,
    pub master: Master,
    pub capabilities: Capabilities,
    pub audio_devices: Vec<AudioDevice>,
    pub mics: Vec<Mic>,
    pub vfa: VfaState,
    pub graphics: Graphics,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub channels: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mic {
    pub mic: usize,
    pub name: String,
    pub device: Option<String>,
    pub channel: u32,
    #[serde(skip_deserializing, default = "empty_status")]
    pub status: SlotStatus,
    #[serde(skip_deserializing)]
    pub error: Option<String>,
    pub volume: f64,
    pub muted: bool,
    pub in_program: bool,
}

fn empty_status() -> SlotStatus {
    SlotStatus::Empty
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VfaState {
    #[serde(flatten)]
    pub config: VfaConfig,
    pub speaking: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAction {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphicInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
    #[serde(default = "one")]
    pub step_count: i64,
    #[serde(default)]
    pub custom_actions: Vec<CustomAction>,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GfxStatus {
    Empty,
    Loading,
    Ready,
    Playing,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphicsLayer {
    pub layer: usize,
    pub graphic_id: Option<String>,
    pub data: serde_json::Value,
    pub status: GfxStatus,
    pub step: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graphics {
    pub renderer_connected: bool,
    pub library: Vec<GraphicInfo>,
    pub layers: Vec<GraphicsLayer>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Levels {
    pub slots: std::collections::BTreeMap<usize, [f64; 2]>,
    pub master: [f64; 2],
    pub mics: std::collections::BTreeMap<usize, f64>,
    /// Pre-fader RMS per video-follows-audio source ("slot:3", "mic:2").
    pub speech: std::collections::BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
pub enum Command {
    SetInput { slot: usize, spec: String, name: Option<String> },
    ClearInput { slot: usize },
    RenameInput { slot: usize, name: String },
    Preview { slot: usize },
    Program { slot: usize },
    Cut,
    Auto,
    #[serde(rename_all = "camelCase")]
    SetTransition { kind: Option<TransitionKind>, duration_ms: Option<u64>, easing: Option<Easing> },
    Tbar { value: f64 },
    Ftb,
    #[serde(rename_all = "camelCase")]
    Overlay {
        index: usize,
        #[serde(default, deserialize_with = "double_option")]
        slot: Option<Option<usize>>,
        rect: Option<Rect>,
        transition: Option<OverlayTransition>,
        duration_ms: Option<u64>,
    },
    OverlayOn { index: usize, on: bool },
    Audio { slot: usize, volume: Option<f64>, muted: Option<bool>, afv: Option<bool> },
    Master { volume: Option<f64>, muted: Option<bool> },
    AddOutput { spec: String },
    RemoveOutput { id: String },
    SetMic { mic: usize, device: String, channel: u32, name: Option<String> },
    ClearMic { mic: usize },
    RenameMic { mic: usize, name: String },
    #[serde(rename_all = "camelCase")]
    MicAudio { mic: usize, volume: Option<f64>, muted: Option<bool>, in_program: Option<bool> },
    RefreshDevices,
    #[serde(rename_all = "camelCase")]
    SetVfa {
        enabled: Option<bool>,
        rules: Option<Vec<VfaRule>>,
        #[serde(default, deserialize_with = "double_option")]
        wide_slot: Option<Option<usize>>,
        threshold_db: Option<f64>,
        dominance_db: Option<f64>,
        attack_ms: Option<u64>,
        min_shot_ms: Option<u64>,
        silence_ms: Option<u64>,
        max_shot_ms: Option<u64>,
        wide_break_ms: Option<u64>,
        transition: Option<VfaTransition>,
    },
    #[serde(rename_all = "camelCase")]
    GfxLoad { layer: usize, graphic_id: String, data: Option<serde_json::Value> },
    #[serde(rename_all = "camelCase")]
    GfxPlay { layer: usize, delta: Option<i64>, goto: Option<i64>, skip_animation: Option<bool> },
    #[serde(rename_all = "camelCase")]
    GfxStop { layer: usize, skip_animation: Option<bool> },
    GfxUpdate { layer: usize, data: serde_json::Value },
    GfxCustom { layer: usize, id: String, payload: Option<serde_json::Value> },
    GfxClear { layer: usize },
    GfxRescan,
}

/// Tells "slot": null (clear) apart from a missing "slot" (leave as is).
fn double_option<'de, D>(d: D) -> Result<Option<Option<usize>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_parse_from_api_json() {
        let c: Command = serde_json::from_str(r#"{"cmd":"setInput","slot":2,"spec":"test:bars"}"#).unwrap();
        assert!(matches!(c, Command::SetInput { slot: 2, .. }));
        let c: Command =
            serde_json::from_str(r#"{"cmd":"setTransition","kind":"pushLeft","durationMs":500}"#).unwrap();
        assert!(matches!(
            c,
            Command::SetTransition { kind: Some(TransitionKind::PushLeft), duration_ms: Some(500), .. }
        ));
        let c: Command = serde_json::from_str(r#"{"cmd":"overlay","index":1,"slot":null}"#).unwrap();
        assert!(matches!(c, Command::Overlay { slot: Some(None), .. }));
        let c: Command = serde_json::from_str(r#"{"cmd":"overlay","index":1}"#).unwrap();
        assert!(matches!(c, Command::Overlay { slot: None, .. }));
    }
}
