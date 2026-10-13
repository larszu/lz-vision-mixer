//! Easing curves for transitions, overlays and fade to black.
//!
//! Same families and formulas as lz-switcher-motion (src/shared/easing.ts), so
//! a curve looks the same in both tools. Each maps progress 0..1 to eased
//! progress; all start at 0 and end at 1, back and elastic overshoot between.

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EaseFamily {
    Linear,
    Sine,
    Quad,
    Cubic,
    Quart,
    Quint,
    Expo,
    Circ,
    Back,
    Elastic,
    Bounce,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EaseDirection {
    In,
    Out,
    InOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Easing {
    pub family: EaseFamily,
    pub direction: EaseDirection,
}

impl Default for Easing {
    fn default() -> Self {
        Easing { family: EaseFamily::Cubic, direction: EaseDirection::InOut }
    }
}

const BACK: f64 = 1.70158;

fn bounce_out(t: f64) -> f64 {
    let n = 7.5625;
    let d = 2.75;
    if t < 1.0 / d {
        n * t * t
    } else if t < 2.0 / d {
        let t = t - 1.5 / d;
        n * t * t + 0.75
    } else if t < 2.5 / d {
        let t = t - 2.25 / d;
        n * t * t + 0.9375
    } else {
        let t = t - 2.625 / d;
        n * t * t + 0.984375
    }
}

fn ease_in(f: EaseFamily, t: f64) -> f64 {
    match f {
        EaseFamily::Linear => t,
        EaseFamily::Sine => 1.0 - (t * PI / 2.0).cos(),
        EaseFamily::Quad => t * t,
        EaseFamily::Cubic => t.powi(3),
        EaseFamily::Quart => t.powi(4),
        EaseFamily::Quint => t.powi(5),
        EaseFamily::Expo => {
            if t == 0.0 {
                0.0
            } else {
                2f64.powf(10.0 * t - 10.0)
            }
        }
        EaseFamily::Circ => 1.0 - (1.0 - t * t).sqrt(),
        EaseFamily::Back => (BACK + 1.0) * t.powi(3) - BACK * t * t,
        EaseFamily::Elastic => {
            if t == 0.0 || t == 1.0 {
                t
            } else {
                -(2f64.powf(10.0 * t - 10.0)) * ((t * 10.0 - 10.75) * (2.0 * PI / 3.0)).sin()
            }
        }
        EaseFamily::Bounce => 1.0 - bounce_out(1.0 - t),
    }
}

pub fn ease(e: Easing, t: f64) -> f64 {
    let x = t.clamp(0.0, 1.0);
    match e.direction {
        EaseDirection::In => ease_in(e.family, x),
        EaseDirection::Out => 1.0 - ease_in(e.family, 1.0 - x),
        EaseDirection::InOut => {
            if x < 0.5 {
                ease_in(e.family, 2.0 * x) / 2.0
            } else {
                1.0 - ease_in(e.family, 2.0 - 2.0 * x) / 2.0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAMILIES: [EaseFamily; 11] = [
        EaseFamily::Linear,
        EaseFamily::Sine,
        EaseFamily::Quad,
        EaseFamily::Cubic,
        EaseFamily::Quart,
        EaseFamily::Quint,
        EaseFamily::Expo,
        EaseFamily::Circ,
        EaseFamily::Back,
        EaseFamily::Elastic,
        EaseFamily::Bounce,
    ];

    #[test]
    fn endpoints() {
        for f in FAMILIES {
            for d in [EaseDirection::In, EaseDirection::Out, EaseDirection::InOut] {
                let e = Easing { family: f, direction: d };
                assert!((ease(e, 0.0)).abs() < 1e-6, "{f:?} {d:?}");
                assert!((ease(e, 1.0) - 1.0).abs() < 1e-6, "{f:?} {d:?}");
            }
        }
    }

    #[test]
    fn quad_matches_t_squared() {
        let e = Easing { family: EaseFamily::Quad, direction: EaseDirection::In };
        assert!((ease(e, 0.5) - 0.25).abs() < 1e-9);
    }

    #[test]
    fn serde_names_match_the_ui() {
        let e: Easing = serde_json::from_str(r#"{"family":"back","direction":"inOut"}"#).unwrap();
        assert_eq!(e, Easing { family: EaseFamily::Back, direction: EaseDirection::InOut });
    }
}
