//! Channel strip for microphones: high-pass, gate, compressor, makeup gain.
//!
//! Plain DSP on mono f32 samples at 48 kHz, no allocation per block, so it
//! can run inside a GStreamer element and be tested on its own. Filters in
//! double precision, as in lz-defeedback.

use serde::{Deserialize, Serialize};

pub const RATE: f64 = 48_000.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StripParams {
    /// High-pass corner in Hz; 0 = off.
    pub hpf_hz: f64,
    pub gate: bool,
    pub gate_threshold_db: f64,
    /// How far the gate closes (positive dB of attenuation).
    pub gate_range_db: f64,
    pub comp: bool,
    pub comp_threshold_db: f64,
    pub comp_ratio: f64,
    pub comp_attack_ms: f64,
    pub comp_release_ms: f64,
    pub makeup_db: f64,
    /// RNNoise speech denoising (rebuilds the mic pipeline when switched).
    pub denoise: bool,
}

impl Default for StripParams {
    fn default() -> Self {
        StripParams {
            hpf_hz: 0.0,
            gate: false,
            gate_threshold_db: -50.0,
            gate_range_db: 20.0,
            comp: false,
            comp_threshold_db: -20.0,
            comp_ratio: 3.0,
            comp_attack_ms: 10.0,
            comp_release_ms: 150.0,
            makeup_db: 0.0,
            denoise: false,
        }
    }
}

impl StripParams {
    pub fn clamped(mut self) -> Self {
        self.hpf_hz = if self.hpf_hz <= 0.0 { 0.0 } else { self.hpf_hz.clamp(20.0, 400.0) };
        self.gate_threshold_db = self.gate_threshold_db.clamp(-90.0, 0.0);
        self.gate_range_db = self.gate_range_db.clamp(0.0, 90.0);
        self.comp_threshold_db = self.comp_threshold_db.clamp(-60.0, 0.0);
        self.comp_ratio = self.comp_ratio.clamp(1.0, 20.0);
        self.comp_attack_ms = self.comp_attack_ms.clamp(0.1, 200.0);
        self.comp_release_ms = self.comp_release_ms.clamp(10.0, 2000.0);
        self.makeup_db = self.makeup_db.clamp(-20.0, 24.0);
        self
    }
}

fn db_to_lin(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

fn lin_to_db(x: f64) -> f64 {
    20.0 * x.max(1e-9).log10()
}

/// One-pole smoothing coefficient for a time constant in ms.
fn coef(ms: f64) -> f64 {
    (-1.0 / (ms.max(0.01) / 1000.0 * RATE)).exp()
}

/// Second-order Butterworth high-pass (RBJ cookbook), transposed direct form II.
#[derive(Debug, Clone, Default)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    fn highpass(hz: f64) -> Biquad {
        let w = 2.0 * std::f64::consts::PI * hz / RATE;
        let (s, c) = w.sin_cos();
        // Q = 1/√2: Butterworth, flat passband.
        let alpha = s / (2.0 * std::f64::consts::FRAC_1_SQRT_2);
        let a0 = 1.0 + alpha;
        Biquad {
            b0: (1.0 + c) / 2.0 / a0,
            b1: -(1.0 + c) / a0,
            b2: (1.0 + c) / 2.0 / a0,
            a1: -2.0 * c / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    #[inline]
    fn run(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

pub struct Strip {
    p: StripParams,
    hpf: Option<[Biquad; 2]>,
    /// Peak envelope for the gate, RMS-ish envelope for the compressor.
    gate_env: f64,
    gate_gain: f64,
    gate_hold: usize,
    comp_env_db: f64,
    // Precomputed per parameter set.
    gate_open: f64,
    gate_floor: f64,
    gate_attack: f64,
    gate_release: f64,
    env_fall: f64,
    comp_attack: f64,
    comp_release: f64,
    makeup: f64,
}

/// Gate hold: stays open this long after the level drops (no chatter between words).
const GATE_HOLD_MS: f64 = 120.0;

impl Strip {
    pub fn new(p: StripParams) -> Strip {
        let mut s = Strip {
            p: StripParams::default(),
            hpf: None,
            gate_env: 0.0,
            gate_gain: 1.0,
            gate_hold: 0,
            comp_env_db: -120.0,
            gate_open: 0.0,
            gate_floor: 1.0,
            gate_attack: 0.0,
            gate_release: 0.0,
            env_fall: 0.0,
            comp_attack: 0.0,
            comp_release: 0.0,
            makeup: 1.0,
        };
        s.set(p);
        s
    }

    pub fn params(&self) -> &StripParams {
        &self.p
    }

    /// New settings; filter state is kept unless the high-pass changes.
    pub fn set(&mut self, p: StripParams) {
        let p = p.clamped();
        if p.hpf_hz != self.p.hpf_hz || self.hpf.is_none() {
            self.hpf = if p.hpf_hz > 0.0 {
                let b = Biquad::highpass(p.hpf_hz);
                Some([b.clone(), b])
            } else {
                None
            };
        }
        self.gate_open = db_to_lin(p.gate_threshold_db);
        self.gate_floor = db_to_lin(-p.gate_range_db);
        self.gate_attack = coef(1.0);
        self.gate_release = coef(80.0);
        self.env_fall = coef(10.0);
        self.comp_attack = coef(p.comp_attack_ms);
        self.comp_release = coef(p.comp_release_ms);
        self.makeup = db_to_lin(p.makeup_db);
        self.p = p;
    }

    /// Gain reduction of the compressor in dB for an input level (soft knee 6 dB).
    fn comp_gain_db(&self, level_db: f64) -> f64 {
        let t = self.p.comp_threshold_db;
        let r = self.p.comp_ratio;
        let knee = 6.0;
        let over = level_db - t;
        if over <= -knee / 2.0 {
            0.0
        } else if over >= knee / 2.0 {
            -(over - over / r)
        } else {
            let x = over + knee / 2.0;
            -((1.0 - 1.0 / r) * x * x / (2.0 * knee))
        }
    }

    pub fn process(&mut self, buf: &mut [f32]) {
        for s in buf.iter_mut() {
            *s = self.tick(*s as f64) as f32;
        }
    }

    /// One channel of interleaved audio: samples `channel`, `channel + n`, …
    pub fn process_channel(&mut self, buf: &mut [f32], channel: usize, channels: usize) {
        for s in buf.iter_mut().skip(channel).step_by(channels.max(1)) {
            *s = self.tick(*s as f64) as f32;
        }
    }

    #[inline]
    fn tick(&mut self, mut x: f64) -> f64 {
        let hold = (GATE_HOLD_MS / 1000.0 * RATE) as usize;
        if let Some([a, b]) = &mut self.hpf {
            x = b.run(a.run(x));
        }
        if self.p.gate {
            // Peak follower: instant up, 10 ms down.
            let a = x.abs();
            self.gate_env = if a > self.gate_env { a } else { a + (self.gate_env - a) * self.env_fall };
            let target = if self.gate_env >= self.gate_open {
                self.gate_hold = hold;
                1.0
            } else if self.gate_hold > 0 {
                self.gate_hold -= 1;
                1.0
            } else {
                self.gate_floor
            };
            let c = if target > self.gate_gain { self.gate_attack } else { self.gate_release };
            self.gate_gain = target + (self.gate_gain - target) * c;
            x *= self.gate_gain;
        }
        if self.p.comp {
            let level = lin_to_db(x.abs());
            let c = if level > self.comp_env_db { self.comp_attack } else { self.comp_release };
            self.comp_env_db = level + (self.comp_env_db - level) * c;
            x *= db_to_lin(self.comp_gain_db(self.comp_env_db));
        }
        x * self.makeup
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(hz: f64, amp: f64, secs: f64) -> Vec<f32> {
        (0..(secs * RATE) as usize)
            .map(|i| (amp * (2.0 * std::f64::consts::PI * hz * i as f64 / RATE).sin()) as f32)
            .collect()
    }

    fn peak(b: &[f32]) -> f64 {
        b.iter().fold(0.0f64, |m, &x| m.max(x.abs() as f64))
    }

    fn tail(b: &[f32]) -> &[f32] {
        &b[b.len() / 2..]
    }

    #[test]
    fn neutral_settings_pass_the_signal_unchanged() {
        let mut s = Strip::new(StripParams::default());
        let input = sine(440.0, 0.5, 0.1);
        let mut out = input.clone();
        s.process(&mut out);
        assert_eq!(input, out);
    }

    #[test]
    fn high_pass_removes_rumble_keeps_voice() {
        let mut s = Strip::new(StripParams { hpf_hz: 100.0, ..Default::default() });
        let mut rumble = sine(30.0, 0.5, 1.0);
        s.process(&mut rumble);
        assert!(peak(tail(&rumble)) < 0.05, "30 Hz {}", peak(tail(&rumble)));
        let mut s = Strip::new(StripParams { hpf_hz: 100.0, ..Default::default() });
        let mut voice = sine(1000.0, 0.5, 1.0);
        s.process(&mut voice);
        assert!(peak(tail(&voice)) > 0.48);
    }

    #[test]
    fn gate_closes_on_room_noise_and_opens_on_speech() {
        let p = StripParams { gate: true, gate_threshold_db: -40.0, gate_range_db: 30.0, ..Default::default() };
        let mut s = Strip::new(p.clone());
        let mut noise = sine(500.0, db_to_lin(-55.0), 1.0);
        s.process(&mut noise);
        // -55 dB minus 30 dB range.
        assert!(lin_to_db(peak(tail(&noise))) < -80.0);
        let mut s = Strip::new(p);
        let mut speech = sine(500.0, db_to_lin(-20.0), 1.0);
        s.process(&mut speech);
        assert!((lin_to_db(peak(tail(&speech))) + 20.0).abs() < 0.5);
    }

    #[test]
    fn compressor_reduces_by_the_ratio_above_threshold() {
        let p = StripParams { comp: true, comp_threshold_db: -20.0, comp_ratio: 4.0, ..Default::default() };
        let mut s = Strip::new(p);
        // 0 dB in: 20 dB over, 4:1 → 5 dB over → about -15 dB out (envelope follows peaks of a sine).
        let mut loud = sine(1000.0, 1.0, 1.0);
        s.process(&mut loud);
        let out = lin_to_db(peak(tail(&loud)));
        assert!((-17.0..-13.0).contains(&out), "{out}");
    }

    #[test]
    fn makeup_gain_applies() {
        let mut s = Strip::new(StripParams { makeup_db: 6.0, ..Default::default() });
        let mut x = vec![0.25f32; 10];
        s.process(&mut x);
        assert!((x[5] - 0.4988).abs() < 0.001);
    }

    #[test]
    fn stereo_channels_are_processed_separately() {
        let p = StripParams { makeup_db: 6.0, ..Default::default() };
        let (mut l, mut r) = (Strip::new(p.clone()), Strip::new(p));
        let mut x = vec![0.25f32, -0.25, 0.25, -0.25];
        l.process_channel(&mut x, 0, 2);
        r.process_channel(&mut x, 1, 2);
        assert!((x[0] - 0.4988).abs() < 0.001 && (x[1] + 0.4988).abs() < 0.001);
    }

    #[test]
    fn soft_knee_is_continuous() {
        let s = Strip::new(StripParams { comp: true, comp_threshold_db: -20.0, comp_ratio: 4.0, ..Default::default() });
        let mut prev = s.comp_gain_db(-40.0);
        for i in 0..400 {
            let g = s.comp_gain_db(-40.0 + i as f64 * 0.1);
            assert!((g - prev).abs() < 0.1);
            prev = g;
        }
    }
}
