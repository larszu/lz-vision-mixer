//! Where the programme compositor puts each picture during a transition or
//! an overlay move. Pure geometry, so it can be tested without GStreamer.

use crate::state::{OverlayTransition, Rect, TransitionKind};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pad {
    pub alpha: f64,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Pad {
    pub const HIDDEN: Pad = Pad { alpha: 0.0, x: 0, y: 0, w: 0, h: 0 };

    pub fn full(w: i32, h: i32) -> Pad {
        Pad { alpha: 1.0, x: 0, y: 0, w, h }
    }
}

/// Picture A (on air) and B (coming) at eased progress `k`. B is drawn above A.
/// `k` may leave 0..1 for overshooting curves; positions follow, alpha clamps.
pub fn transition(kind: TransitionKind, k: f64, w: i32, h: i32) -> (Pad, Pad) {
    let full = Pad::full(w, h);
    let wf = w as f64;
    let hf = h as f64;
    let a01 = k.clamp(0.0, 1.0);
    match kind {
        TransitionKind::Cut => {
            if k >= 1.0 {
                (Pad::HIDDEN, full)
            } else {
                (full, Pad::HIDDEN)
            }
        }
        TransitionKind::Mix => (full, Pad { alpha: a01, ..full }),
        // Through black: A fades out over the first half, B in over the second.
        TransitionKind::Dip => (
            Pad { alpha: (1.0 - 2.0 * a01).max(0.0), ..full },
            Pad { alpha: (2.0 * a01 - 1.0).max(0.0), ..full },
        ),
        TransitionKind::PushLeft => (
            Pad { x: (-k * wf).round() as i32, ..full },
            Pad { x: ((1.0 - k) * wf).round() as i32, ..full },
        ),
        TransitionKind::PushRight => (
            Pad { x: (k * wf).round() as i32, ..full },
            Pad { x: (-(1.0 - k) * wf).round() as i32, ..full },
        ),
        TransitionKind::SlideLeft => (full, Pad { x: ((1.0 - k) * wf).round() as i32, ..full }),
        TransitionKind::SlideRight => (full, Pad { x: (-(1.0 - k) * wf).round() as i32, ..full }),
        TransitionKind::Zoom => {
            let s = k.max(0.0);
            let bw = (wf * s).round() as i32;
            let bh = (hf * s).round() as i32;
            (
                full,
                Pad { alpha: if s > 0.0 { 1.0 } else { 0.0 }, x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh },
            )
        }
    }
}

/// An overlay at progress `k` of its way in (0 = off, 1 = in place).
pub fn overlay(kind: OverlayTransition, k: f64, rect: Rect, w: i32, h: i32) -> Pad {
    let wf = w as f64;
    let hf = h as f64;
    let tx = rect.x * wf;
    let ty = rect.y * hf;
    let tw = rect.w * wf;
    let th = rect.h * hf;
    let place = |x: f64, y: f64, pw: f64, ph: f64, alpha: f64| Pad {
        alpha,
        x: x.round() as i32,
        y: y.round() as i32,
        w: pw.round().max(0.0) as i32,
        h: ph.round().max(0.0) as i32,
    };
    let visible = if k > 0.0 { 1.0 } else { 0.0 };
    match kind {
        OverlayTransition::Cut => place(tx, ty, tw, th, if k >= 1.0 { 1.0 } else { 0.0 }),
        OverlayTransition::Fade => place(tx, ty, tw, th, k.clamp(0.0, 1.0)),
        // Fly in from outside the frame: start just past the edge.
        OverlayTransition::FlyLeft => place(-tw + (tx + tw) * k, ty, tw, th, visible),
        OverlayTransition::FlyRight => place(wf + (tx - wf) * k, ty, tw, th, visible),
        OverlayTransition::FlyTop => place(tx, -th + (ty + th) * k, tw, th, visible),
        OverlayTransition::FlyBottom => place(tx, hf + (ty - hf) * k, tw, th, visible),
        OverlayTransition::Zoom => {
            let s = k.max(0.0);
            let cx = tx + tw / 2.0;
            let cy = ty + th / 2.0;
            place(cx - tw * s / 2.0, cy - th * s / 2.0, tw * s, th * s, visible)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: i32 = 1920;
    const H: i32 = 1080;

    #[test]
    fn every_transition_ends_with_b_full_frame() {
        for kind in [
            TransitionKind::Cut,
            TransitionKind::Mix,
            TransitionKind::Dip,
            TransitionKind::PushLeft,
            TransitionKind::PushRight,
            TransitionKind::SlideLeft,
            TransitionKind::SlideRight,
            TransitionKind::Zoom,
        ] {
            let (_, b) = transition(kind, 1.0, W, H);
            assert_eq!(b, Pad::full(W, H), "{kind:?}");
            let (a, _) = transition(kind, 0.0, W, H);
            assert_eq!(a, Pad::full(W, H), "{kind:?}");
        }
    }

    #[test]
    fn dip_passes_through_black() {
        let (a, b) = transition(TransitionKind::Dip, 0.5, W, H);
        assert_eq!((a.alpha, b.alpha), (0.0, 0.0));
    }

    #[test]
    fn push_moves_both_pictures() {
        let (a, b) = transition(TransitionKind::PushLeft, 0.25, W, H);
        assert_eq!((a.x, b.x), (-480, 1440));
    }

    #[test]
    fn overlay_flies_into_place() {
        let r = Rect { x: 0.7, y: 0.05, w: 0.25, h: 0.25 };
        let start = overlay(OverlayTransition::FlyRight, 0.0, r, W, H);
        assert_eq!(start.x, W);
        assert_eq!(start.alpha, 0.0);
        let end = overlay(OverlayTransition::FlyRight, 1.0, r, W, H);
        assert_eq!((end.x, end.y, end.w, end.h), (1344, 54, 480, 270));
    }
}
