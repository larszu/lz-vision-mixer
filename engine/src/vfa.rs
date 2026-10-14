//! Video follows audio: decides which camera to cut to from speech levels.
//!
//! Pure logic with explicit time, so every rule can be tested without audio.
//! The mixer feeds it pre-fader RMS levels ten times a second and performs the
//! cuts it asks for.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfaRule {
    /// "slot:N" (an input's own audio) or "mic:N".
    pub source: String,
    /// Camera input slot.
    pub camera: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VfaTransition {
    Cut,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VfaConfig {
    pub enabled: bool,
    pub rules: Vec<VfaRule>,
    pub wide_slot: Option<usize>,
    pub threshold_db: f64,
    pub dominance_db: f64,
    pub attack_ms: u64,
    pub min_shot_ms: u64,
    pub silence_ms: u64,
    pub max_shot_ms: u64,
    pub wide_break_ms: u64,
    pub transition: VfaTransition,
}

impl Default for VfaConfig {
    fn default() -> Self {
        VfaConfig {
            enabled: false,
            rules: Vec::new(),
            wide_slot: None,
            threshold_db: -42.0,
            dominance_db: 6.0,
            attack_ms: 400,
            min_shot_ms: 2500,
            silence_ms: 2500,
            max_shot_ms: 0,
            wide_break_ms: 3000,
            transition: VfaTransition::Cut,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Target {
    Speaker(String),
    Wide,
}

#[derive(Debug, Default)]
pub struct Vfa {
    pub cfg: VfaConfig,
    current: Option<Target>,
    shot_since: u64,
    candidate: Option<Target>,
    candidate_since: u64,
    silence_since: Option<u64>,
    /// While set, a wide shot forced by `max_shot_ms` lasts until this time.
    break_until: Option<u64>,
}

impl Vfa {
    pub fn new(cfg: VfaConfig) -> Self {
        Vfa { cfg, ..Default::default() }
    }

    /// What the UI shows as speaking: a source, "wide", or nothing.
    pub fn speaking(&self) -> Option<String> {
        match &self.current {
            Some(Target::Speaker(s)) => Some(s.clone()),
            Some(Target::Wide) => Some("wide".into()),
            None => None,
        }
    }

    /// The operator switched by hand: the new shot gets its minimum time too.
    pub fn manual(&mut self, now: u64) {
        self.shot_since = now;
        self.break_until = None;
    }

    pub fn reset(&mut self) {
        self.current = None;
        self.candidate = None;
        self.silence_since = None;
        self.break_until = None;
    }

    fn camera(&self, t: &Target) -> Option<usize> {
        match t {
            Target::Wide => self.cfg.wide_slot,
            Target::Speaker(s) => self.cfg.rules.iter().find(|r| &r.source == s).map(|r| r.camera),
        }
    }

    /// One decision step. `levels` maps sources to RMS dBFS. Returns the
    /// camera slot to switch to, if any.
    pub fn tick(&mut self, now: u64, levels: &BTreeMap<String, f64>) -> Option<usize> {
        if !self.cfg.enabled || self.cfg.rules.is_empty() {
            return None;
        }
        let mut active: Vec<(&str, f64)> = self
            .cfg
            .rules
            .iter()
            .filter_map(|r| levels.get(&r.source).map(|&l| (r.source.as_str(), l)))
            .filter(|(_, l)| *l >= self.cfg.threshold_db)
            .collect();
        active.sort_by(|a, b| b.1.total_cmp(&a.1));
        active.dedup_by(|a, b| a.0 == b.0);

        // A forced wide break runs out before anything else is decided.
        if let Some(until) = self.break_until {
            if now < until {
                return None;
            }
            self.break_until = None;
            // Back to whoever speaks now, without waiting for the minimum shot.
            self.shot_since = 0;
        }

        let desired = if active.is_empty() {
            let since = *self.silence_since.get_or_insert(now);
            if now.saturating_sub(since) >= self.cfg.silence_ms { Some(Target::Wide) } else { None }
        } else {
            self.silence_since = None;
            if active.len() == 1 || active[0].1 - active[1].1 >= self.cfg.dominance_db {
                Some(Target::Speaker(active[0].0.to_string()))
            } else {
                Some(Target::Wide)
            }
        };

        // Same speaker for too long: give the viewer a wide shot.
        if self.cfg.max_shot_ms > 0
            && matches!(self.current, Some(Target::Speaker(_)))
            && desired == self.current
            && now.saturating_sub(self.shot_since) >= self.cfg.max_shot_ms
            && self.cfg.wide_slot.is_some()
        {
            self.current = Some(Target::Wide);
            self.shot_since = now;
            self.break_until = Some(now + self.cfg.wide_break_ms);
            // The candidate stays: when the break ends and the same person
            // still speaks, the cut back needs no new attack time.
            return self.cfg.wide_slot;
        }

        let Some(desired) = desired else { return None };
        if self.candidate.as_ref() != Some(&desired) {
            self.candidate = Some(desired.clone());
            self.candidate_since = now;
        }
        // Silence is already timed by silence_ms; only speech needs the attack.
        let attack = if active.is_empty() { 0 } else { self.cfg.attack_ms };
        if now.saturating_sub(self.candidate_since) < attack
            || self.current.as_ref() == Some(&desired)
            || (self.current.is_some() && now.saturating_sub(self.shot_since) < self.cfg.min_shot_ms)
        {
            return None;
        }
        let cam = self.camera(&desired)?;
        let prev_cam = self.current.as_ref().and_then(|t| self.camera(t));
        self.current = Some(desired);
        if prev_cam == Some(cam) {
            // Two sources on one camera: nothing to cut, but keep the timer.
            return None;
        }
        self.shot_since = now;
        Some(cam)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vfa() -> Vfa {
        Vfa::new(VfaConfig {
            enabled: true,
            rules: vec![
                VfaRule { source: "mic:1".into(), camera: 1 },
                VfaRule { source: "mic:2".into(), camera: 2 },
            ],
            wide_slot: Some(3),
            ..Default::default()
        })
    }

    fn lv(a: f64, b: f64) -> BTreeMap<String, f64> {
        BTreeMap::from([("mic:1".into(), a), ("mic:2".into(), b)])
    }

    /// Runs ticks every 100 ms from `from` to `to` and collects the cuts.
    fn run(v: &mut Vfa, from: u64, to: u64, l: &BTreeMap<String, f64>) -> Vec<(u64, usize)> {
        (from..to).step_by(100).filter_map(|t| v.tick(t, l).map(|c| (t, c))).collect()
    }

    #[test]
    fn cuts_to_the_speaker_after_the_attack_time() {
        let mut v = vfa();
        let cuts = run(&mut v, 10_000, 11_000, &lv(-20.0, -60.0));
        assert_eq!(cuts, vec![(10_400, 1)]);
        assert_eq!(v.speaking().as_deref(), Some("mic:1"));
    }

    #[test]
    fn a_short_word_does_not_cut() {
        let mut v = vfa();
        run(&mut v, 10_000, 13_000, &lv(-20.0, -60.0));
        // 300 ms from the other speaker, then back.
        let cuts = run(&mut v, 13_000, 13_300, &lv(-60.0, -20.0));
        assert!(cuts.is_empty());
    }

    #[test]
    fn bleed_into_the_other_mic_does_not_count() {
        let mut v = vfa();
        // mic:2 picks up mic:1's speaker 10 dB quieter: still mic:1.
        assert_eq!(run(&mut v, 10_000, 11_000, &lv(-20.0, -30.0)), vec![(10_400, 1)]);
    }

    #[test]
    fn crosstalk_goes_wide() {
        let mut v = vfa();
        run(&mut v, 10_000, 13_000, &lv(-20.0, -60.0));
        let cuts = run(&mut v, 13_000, 14_000, &lv(-20.0, -22.0));
        assert_eq!(cuts, vec![(13_400, 3)]);
    }

    #[test]
    fn minimum_shot_holds_a_quick_reply() {
        let mut v = vfa();
        run(&mut v, 10_000, 10_500, &lv(-20.0, -60.0)); // cut to 1 at 10.4 s
        let cuts = run(&mut v, 10_500, 13_500, &lv(-60.0, -20.0));
        // Speaker 2 is clear from 10.9 s, but shot 1 must last until 12.9 s.
        assert_eq!(cuts, vec![(12_900, 2)]);
    }

    #[test]
    fn silence_goes_wide_after_its_time() {
        let mut v = vfa();
        run(&mut v, 10_000, 13_000, &lv(-20.0, -60.0));
        let cuts = run(&mut v, 13_000, 17_000, &lv(-70.0, -70.0));
        assert_eq!(cuts, vec![(15_500, 3)]);
    }

    #[test]
    fn long_monologue_gets_a_wide_break_and_comes_back() {
        let mut v = vfa();
        v.cfg.max_shot_ms = 10_000;
        v.cfg.wide_break_ms = 3_000;
        let cuts = run(&mut v, 0, 20_000, &lv(-20.0, -60.0));
        assert_eq!(cuts, vec![(400, 1), (10_400, 3), (13_400, 1)]);
    }

    #[test]
    fn disabled_does_nothing() {
        let mut v = vfa();
        v.cfg.enabled = false;
        assert!(run(&mut v, 0, 5000, &lv(-20.0, -60.0)).is_empty());
    }

    #[test]
    fn manual_cut_restarts_the_minimum_shot() {
        let mut v = vfa();
        run(&mut v, 10_000, 13_000, &lv(-20.0, -60.0));
        v.manual(13_000);
        let cuts = run(&mut v, 13_000, 16_000, &lv(-60.0, -20.0));
        assert_eq!(cuts, vec![(15_500, 2)]);
    }

    #[test]
    fn config_reads_partial_json() {
        let c: VfaConfig = serde_json::from_str(r#"{"enabled":true,"thresholdDb":-35}"#).unwrap();
        assert!(c.enabled);
        assert_eq!(c.threshold_db, -35.0);
        assert_eq!(c.min_shot_ms, 2500);
    }
}
