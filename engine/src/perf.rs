//! Load of the mixer and a forecast of how many more inputs and mics fit.
//!
//! The forecast does not guess from specs: it learns what an input and a
//! mic cost on this machine. Every few seconds the engine notes its own CPU
//! load together with the number of running inputs and mics; a least-squares
//! fit over those samples gives the cost of one more of each. Until there is
//! enough spread in the samples, conservative defaults are used and the
//! forecast says so.

use serde::Serialize;
use std::collections::VecDeque;

/// Share of the whole machine the mixer may use before it counts as full.
pub const BUDGET: f64 = 0.80;
/// Defaults in percent of ONE core, from 1080p50 test inputs on an M1 Pro.
const DEFAULT_PER_INPUT: f64 = 45.0;
const DEFAULT_PER_MIC: f64 = 2.0;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    /// How many more running video inputs fit; None while overloaded.
    pub more_inputs: Option<u32>,
    pub more_mics: Option<u32>,
    /// Cost of one, in percent of one core.
    pub per_input: f64,
    pub per_mic: f64,
    /// "measured" once the fit has data, else "estimate".
    pub basis: &'static str,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Perf {
    /// Engine CPU in percent of the whole machine (0..100).
    pub cpu: f64,
    /// Whole machine, all programs.
    pub system_cpu: f64,
    pub cores: usize,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub process_memory_mb: u64,
    /// Programme frames actually produced per second vs. the format.
    pub output_fps: f64,
    pub nominal_fps: f64,
    pub overloaded: bool,
    pub running_inputs: usize,
    pub running_mics: usize,
    pub forecast: Forecast,
}

/// Samples of (inputs, mics, engine CPU in percent of one core).
#[derive(Default)]
pub struct Model {
    samples: VecDeque<(f64, f64, f64)>,
    /// Costs learned in an earlier run, used until this run has its own.
    pub prior: Option<(f64, f64)>,
}

impl Model {
    pub fn add(&mut self, inputs: usize, mics: usize, cpu_core_pct: f64) {
        self.samples.push_back((inputs as f64, mics as f64, cpu_core_pct));
        if self.samples.len() > 120 {
            self.samples.pop_front();
        }
    }

    /// Cost per input and per mic, and whether they come from data.
    pub fn costs(&self) -> (f64, f64, bool) {
        // Least squares for cpu = a + b·inputs + c·mics, solved by the normal
        // equations (3×3). Needs at least two input counts to say anything.
        let n = self.samples.len() as f64;
        let distinct_inputs = {
            let mut v: Vec<i64> = self.samples.iter().map(|s| s.0 as i64).collect();
            v.sort();
            v.dedup();
            v.len()
        };
        if n < 4.0 || distinct_inputs < 2 {
            return match self.prior {
                Some((a, b)) => (a, b, true),
                None => (DEFAULT_PER_INPUT, DEFAULT_PER_MIC, false),
            };
        }
        let (mut sx, mut sy, mut sz, mut sxx, mut syy, mut sxy, mut sxz, mut syz) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        for &(x, y, z) in &self.samples {
            sx += x;
            sy += y;
            sz += z;
            sxx += x * x;
            syy += y * y;
            sxy += x * y;
            sxz += x * z;
            syz += y * z;
        }
        let m = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
        let r = [sz, sxz, syz];
        let det = |m: [[f64; 3]; 3]| {
            m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
        };
        let d = det(m);
        let col = |i: usize| {
            let mut c = m;
            for row in 0..3 {
                c[row][i] = r[row];
            }
            det(c) / d
        };
        if d.abs() < 1e-9 {
            // Mics never changed: fit inputs alone, keep the mic default.
            let b = (n * sxz - sx * sz) / (n * sxx - sx * sx);
            return (b.max(1.0), DEFAULT_PER_MIC, true);
        }
        (col(1).max(1.0), col(2).max(0.2), true)
    }
}

/// Free room, in percent of one core, divided by the cost. The room is what
/// the whole machine has left under the budget — other programs (browser,
/// graphics renderer, streaming software) take from the same cores.
pub fn forecast(model: &Model, cores: usize, system_pct: f64, overloaded: bool) -> Forecast {
    let (per_input, per_mic, measured) = model.costs();
    let room = (BUDGET * 100.0 - system_pct) * cores as f64;
    let fit = |cost: f64| if overloaded || room <= 0.0 { Some(0) } else { Some((room / cost).floor() as u32) };
    Forecast {
        more_inputs: fit(per_input),
        more_mics: fit(per_mic),
        per_input: (per_input * 10.0).round() / 10.0,
        per_mic: (per_mic * 10.0).round() / 10.0,
        basis: if measured { "measured" } else { "estimate" },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_until_there_is_spread() {
        let mut m = Model::default();
        for _ in 0..10 {
            m.add(3, 2, 150.0);
        }
        assert_eq!(m.costs(), (DEFAULT_PER_INPUT, DEFAULT_PER_MIC, false));
    }

    #[test]
    fn learns_cost_per_input_and_mic() {
        let mut m = Model::default();
        // Base 20 %, 30 % per input, 3 % per mic.
        for (i, k) in [(1, 0), (2, 1), (3, 1), (4, 2), (2, 4), (5, 3)] {
            m.add(i, k, 20.0 + 30.0 * i as f64 + 3.0 * k as f64);
        }
        let (a, b, measured) = m.costs();
        assert!(measured);
        assert!((a - 30.0).abs() < 0.01, "{a}");
        assert!((b - 3.0).abs() < 0.01, "{b}");
    }

    #[test]
    fn forecast_fills_the_budget() {
        let mut m = Model::default();
        for i in 1..=4 {
            m.add(i, 0, 20.0 + 50.0 * i as f64);
        }
        // 10 cores, machine at 22 %: room (80 - 22) × 10 = 580 % at 50 % each → 11.
        let f = forecast(&m, 10, 22.0, false);
        assert_eq!(f.more_inputs, Some(11));
        assert_eq!(f.basis, "measured");
        assert_eq!(forecast(&m, 10, 22.0, true).more_inputs, Some(0));
        // Machine already above the budget: nothing more.
        assert_eq!(forecast(&m, 10, 90.0, false).more_inputs, Some(0));
    }
}
