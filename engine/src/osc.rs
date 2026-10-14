//! OSC in and out, for TouchOSC, UnableSet, the intercom's keyword rules,
//! lighting desks and anything else that speaks OSC.
//!
//! In: addresses under /lzvm map onto the same commands as the HTTP API.
//! Numbers may come in the path (/lzvm/preview/3) or as an argument
//! (/lzvm/preview 3), so senders that only append their own string arguments
//! — like the intercom's keyword rules — still work.
//! Out: tally and status changes to every configured target.

use crate::mixer::Mixer;
use crate::state::{Command, GfxStatus, State};
use rosc::{OscMessage, OscPacket, OscType};
use std::net::SocketAddr;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Cmd(Command),
    OverlayToggle(usize),
    VfaToggle,
    /// Text for the captions graphic: updateAction with {"text": …}.
    Caption { text: String, layer: Option<usize> },
}

fn num(a: &OscType) -> Option<f64> {
    match a {
        OscType::Int(i) => Some(*i as f64),
        OscType::Long(i) => Some(*i as f64),
        OscType::Float(f) => Some(*f as f64),
        OscType::Double(d) => Some(*d),
        OscType::String(s) => s.trim().parse().ok(),
        OscType::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn text(a: &OscType) -> Option<String> {
    match a {
        OscType::String(s) => Some(s.clone()),
        _ => None,
    }
}

/// Maps one OSC message to an action. Unknown addresses give None.
pub fn parse(addr: &str, args: &[OscType]) -> Option<Action> {
    let parts: Vec<&str> = addr.trim_matches('/').split('/').collect();
    let (root, rest) = parts.split_first()?;
    if *root != "lzvm" {
        return None;
    }
    // A number either as the next path segment or as the first argument.
    let n_at = |i: usize| -> Option<usize> {
        rest.get(i).and_then(|s| s.parse().ok()).or_else(|| args.first().and_then(num).map(|v| v as usize))
    };
    let cmd = |c: Command| Some(Action::Cmd(c));
    match rest {
        ["cut"] => cmd(Command::Cut),
        ["auto"] => cmd(Command::Auto),
        ["ftb"] => cmd(Command::Ftb),
        ["preview", ..] => cmd(Command::Preview { slot: n_at(1)? }),
        ["program", ..] => cmd(Command::Program { slot: n_at(1)? }),
        ["tbar"] => cmd(Command::Tbar { value: args.first().and_then(num)? }),
        ["overlay", i, "on"] => cmd(Command::OverlayOn { index: i.parse().ok()?, on: true }),
        ["overlay", i, "off"] => cmd(Command::OverlayOn { index: i.parse().ok()?, on: false }),
        ["overlay", i, "toggle"] => Some(Action::OverlayToggle(i.parse().ok()?)),
        ["vfa", "on"] => cmd(vfa_enabled(true)),
        ["vfa", "off"] => cmd(vfa_enabled(false)),
        ["vfa", "toggle"] => Some(Action::VfaToggle),
        ["gfx", l, verb] => {
            let layer: usize = l.parse().ok()?;
            match *verb {
                "play" => cmd(Command::GfxPlay { layer, delta: None, goto: None, skip_animation: None }),
                "next" => cmd(Command::GfxPlay { layer, delta: Some(1), goto: None, skip_animation: None }),
                "stop" => cmd(Command::GfxStop { layer, skip_animation: None }),
                "clear" => cmd(Command::GfxClear { layer }),
                "load" => {
                    let graphic_id = args.first().and_then(text)?;
                    let data = args.get(1).and_then(text).and_then(|s| serde_json::from_str(&s).ok());
                    cmd(Command::GfxLoad { layer, graphic_id, data })
                }
                "update" => {
                    let data = serde_json::from_str(&args.first().and_then(text)?).ok()?;
                    cmd(Command::GfxUpdate { layer, data })
                }
                _ => None,
            }
        }
        ["caption"] => Some(Action::Caption {
            text: args.first().and_then(text)?,
            layer: args.get(1).and_then(num).map(|v| v as usize),
        }),
        ["cmd"] => serde_json::from_str(&args.first().and_then(text)?).ok().map(Action::Cmd),
        _ => None,
    }
}

fn vfa_enabled(on: bool) -> Command {
    Command::SetVfa {
        enabled: Some(on),
        rules: None,
        wide_slot: None,
        threshold_db: None,
        dominance_db: None,
        attack_ms: None,
        min_shot_ms: None,
        silence_ms: None,
        max_shot_ms: None,
        wide_break_ms: None,
        transition: None,
    }
}

impl Action {
    /// Turns toggles and captions into commands against the current state.
    pub fn resolve(self, s: &State) -> Vec<Command> {
        match self {
            Action::Cmd(c) => vec![c],
            Action::OverlayToggle(i) => match s.overlays.get(i.wrapping_sub(1)) {
                Some(o) => vec![Command::OverlayOn { index: i, on: !o.on_air }],
                None => vec![],
            },
            Action::VfaToggle => vec![vfa_enabled(!s.vfa.config.enabled)],
            Action::Caption { text, layer } => {
                let data = serde_json::json!({ "text": text });
                let is_captions = |l: &crate::state::GraphicsLayer| {
                    l.graphic_id.as_deref().is_some_and(|g| g.contains("caption"))
                };
                // The layer asked for, else the one already showing captions,
                // else layer 2 (layer 1 is usually the lower third).
                let target = layer
                    .and_then(|n| s.graphics.layers.iter().find(|l| l.layer == n))
                    .or_else(|| s.graphics.layers.iter().find(|l| is_captions(l)))
                    .or_else(|| s.graphics.layers.iter().find(|l| l.layer == 2));
                let Some(l) = target else { return vec![] };
                let play = Command::GfxPlay { layer: l.layer, delta: None, goto: None, skip_animation: None };
                if !is_captions(l) {
                    // Nothing loaded there yet: bring up the captions graphic with the text.
                    vec![Command::GfxLoad { layer: l.layer, graphic_id: "lz-captions".into(), data: Some(data) }, play]
                } else if l.status != GfxStatus::Playing {
                    vec![Command::GfxUpdate { layer: l.layer, data }, play]
                } else {
                    vec![Command::GfxUpdate { layer: l.layer, data }]
                }
            }
        }
    }
}

/// The values sent out as feedback, so only changes go on the wire.
pub fn feedback(s: &State) -> Vec<(String, OscType)> {
    let mut out = vec![
        ("/lzvm/program".into(), OscType::Int(s.program.unwrap_or(0) as i32)),
        ("/lzvm/preview".into(), OscType::Int(s.preview.unwrap_or(0) as i32)),
        ("/lzvm/ftb".into(), OscType::Int(s.ftb as i32)),
        ("/lzvm/transition".into(), OscType::Int(s.in_transition as i32)),
        ("/lzvm/vfa".into(), OscType::Int(s.vfa.config.enabled as i32)),
        ("/lzvm/vfa/speaking".into(), OscType::String(s.vfa.speaking.clone().unwrap_or_default())),
    ];
    for slot in &s.slots {
        let n = slot.slot;
        let t = if s.program == Some(n) { 2 } else if s.preview == Some(n) { 1 } else { 0 };
        out.push((format!("/lzvm/tally/{n}"), OscType::Int(t)));
    }
    for o in &s.overlays {
        out.push((format!("/lzvm/overlay/{}", o.index), OscType::Int(o.on_air as i32)));
    }
    for l in &s.graphics.layers {
        let st = serde_json::to_value(l.status).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        out.push((format!("/lzvm/gfx/{}/status", l.layer), OscType::String(st)));
        out.push((
            format!("/lzvm/gfx/{}/onair", l.layer),
            OscType::Int((l.status == GfxStatus::Playing) as i32),
        ));
    }
    out
}

/// Receives OSC on `listen` and sends feedback to the targets in the state.
pub async fn run(mixer: Arc<Mixer>, listen: SocketAddr) -> anyhow::Result<()> {
    let sock = Arc::new(tokio::net::UdpSocket::bind(listen).await?);
    tracing::info!("OSC on {listen}");
    let rx_sock = sock.clone();
    let m = mixer.clone();
    tokio::spawn(async move {
        let mut buf = vec![0u8; 65536];
        loop {
            let Ok((n, _from)) = rx_sock.recv_from(&mut buf).await else { continue };
            let Ok((_, packet)) = rosc::decoder::decode_udp(&buf[..n]) else { continue };
            let mut msgs = Vec::new();
            flatten(packet, &mut msgs);
            for msg in msgs {
                let Some(action) = parse(&msg.addr, &msg.args) else { continue };
                let m2 = m.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    for cmd in action.resolve(&m2.state()) {
                        if let Err(e) = m2.handle(cmd) {
                            tracing::debug!("OSC {}: {e:#}", msg.addr);
                            break;
                        }
                    }
                })
                .await;
            }
        }
    });
    // Feedback: on every state change, send what differs per target. A new
    // target gets everything once.
    let mut changed = mixer.changed.subscribe();
    let mut sent: std::collections::HashMap<String, Vec<(String, OscType)>> = Default::default();
    loop {
        let s = mixer.state();
        let now = feedback(&s);
        for target in &s.osc.targets {
            let Ok(addr) = tokio::net::lookup_host(target.as_str()).await.map(|mut a| a.next()) else { continue };
            let Some(addr) = addr else { continue };
            let prev = sent.get(target);
            for (path, val) in &now {
                let same = prev.and_then(|p| p.iter().find(|(a, _)| a == path)).map(|(_, v)| v == val);
                if same == Some(true) {
                    continue;
                }
                let packet = OscPacket::Message(OscMessage { addr: path.clone(), args: vec![val.clone()] });
                if let Ok(bytes) = rosc::encoder::encode(&packet) {
                    let _ = sock.send_to(&bytes, addr).await;
                }
            }
            sent.insert(target.clone(), now.clone());
        }
        sent.retain(|t, _| s.osc.targets.contains(t));
        if changed.changed().await.is_err() {
            return Ok(());
        }
    }
}

fn flatten(p: OscPacket, out: &mut Vec<OscMessage>) {
    match p {
        OscPacket::Message(m) => out.push(m),
        OscPacket::Bundle(b) => b.content.into_iter().for_each(|p| flatten(p, out)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(addr: &str, args: Vec<OscType>) -> Option<Action> {
        parse(addr, &args)
    }

    #[test]
    fn numbers_in_path_or_argument() {
        assert_eq!(p("/lzvm/preview/3", vec![]), Some(Action::Cmd(Command::Preview { slot: 3 })));
        assert_eq!(p("/lzvm/preview", vec![OscType::Int(4)]), Some(Action::Cmd(Command::Preview { slot: 4 })));
        assert_eq!(p("/lzvm/program", vec![OscType::Float(2.0)]), Some(Action::Cmd(Command::Program { slot: 2 })));
    }

    #[test]
    fn extra_string_arguments_are_ignored() {
        // The intercom's keyword rules append text, channel, speaker, keyword.
        let args = vec![OscType::String("cut now".into()), OscType::String("Regie".into())];
        assert_eq!(p("/lzvm/cut", args.clone()), Some(Action::Cmd(Command::Cut)));
        assert!(matches!(p("/lzvm/gfx/1/play", args), Some(Action::Cmd(Command::GfxPlay { layer: 1, .. }))));
    }

    #[test]
    fn graphics_load_with_json_data() {
        let a = p(
            "/lzvm/gfx/2/load",
            vec![OscType::String("lz-lower-third".into()), OscType::String(r#"{"name":"Anna"}"#.into())],
        );
        match a {
            Some(Action::Cmd(Command::GfxLoad { layer: 2, graphic_id, data: Some(d) })) => {
                assert_eq!(graphic_id, "lz-lower-third");
                assert_eq!(d["name"], "Anna");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn captions_and_generic_commands() {
        assert_eq!(
            p("/lzvm/caption", vec![OscType::String("Hallo".into())]),
            Some(Action::Caption { text: "Hallo".into(), layer: None })
        );
        assert_eq!(
            p("/lzvm/cmd", vec![OscType::String(r#"{"cmd":"setInput","slot":1,"spec":"test:bars"}"#.into())]),
            Some(Action::Cmd(Command::SetInput { slot: 1, spec: "test:bars".into(), name: None }))
        );
    }

    #[test]
    fn foreign_addresses_are_ignored() {
        assert_eq!(p("/live/song", vec![]), None);
        assert_eq!(p("/lzvm/unknown", vec![]), None);
    }
}
