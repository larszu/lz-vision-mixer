// Mic channel strip and delays: pure helpers (no DOM), unit-tested.
import type { Strip } from './types'

export type StripNumKey = 'hpfHz' | 'gateThresholdDb' | 'gateRangeDb' | 'compThresholdDb' | 'compRatio' | 'compAttackMs' | 'compReleaseMs' | 'makeupDb'

export interface StripRange {
  key: StripNumKey
  label: string
  hint?: string
  min: number
  max: number
  unit: 'Hz' | 'dB' | 'ms' | ':1'
  /** Slider travel is logarithmic (frequencies and times). */
  log?: boolean
  /** Linear step; log ranges round to a sensible precision instead. */
  step?: number
}

/** Ranges from docs/api.md (Strip). */
export const STRIP_RANGES: Record<StripNumKey, StripRange> = {
  hpfHz: { key: 'hpfHz', label: 'Frequency', hint: 'Cuts rumble and handling noise below this frequency', min: 20, max: 400, unit: 'Hz', log: true },
  gateThresholdDb: { key: 'gateThresholdDb', label: 'Threshold', hint: 'Below this level the gate closes', min: -90, max: 0, step: 1, unit: 'dB' },
  gateRangeDb: { key: 'gateRangeDb', label: 'Range', hint: 'How much the closed gate lowers the level', min: 0, max: 90, step: 1, unit: 'dB' },
  compThresholdDb: { key: 'compThresholdDb', label: 'Threshold', hint: 'Above this level the compressor works', min: -60, max: 0, step: 1, unit: 'dB' },
  compRatio: { key: 'compRatio', label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
  compAttackMs: { key: 'compAttackMs', label: 'Attack', min: 0.1, max: 200, unit: 'ms', log: true },
  compReleaseMs: { key: 'compReleaseMs', label: 'Release', min: 10, max: 2000, unit: 'ms', log: true },
  makeupDb: { key: 'makeupDb', label: 'Makeup', hint: 'Gain after the compressor', min: -20, max: 24, step: 0.5, unit: 'dB' },
}

/** High-pass quick picks; 0 = off. */
export const HPF_STEPS = [0, 60, 80, 100, 120]

export interface StripPreset {
  id: string
  label: string
  /** Only these fields are set and compared. */
  strip: Partial<Strip>
}

export const STRIP_PRESETS: StripPreset[] = [
  {
    id: 'speech',
    label: 'Speech (podcast)',
    strip: {
      denoise: true,
      hpfHz: 80,
      gate: true,
      gateThresholdDb: -50,
      gateRangeDb: 20,
      comp: true,
      compThresholdDb: -20,
      compRatio: 3,
      compAttackMs: 10,
      compReleaseMs: 150,
      makeupDb: 3,
    },
  },
  // Neutral: every stage off; the parameters of gate and compressor stay for the next time.
  { id: 'off', label: 'Off', strip: { denoise: false, hpfHz: 0, gate: false, comp: false, makeupDb: 0 } },
]

/** What an engine without a channel strip effectively does. */
export const STRIP_NEUTRAL: Strip = {
  hpfHz: 0,
  gate: false,
  gateThresholdDb: -50,
  gateRangeDb: 20,
  comp: false,
  compThresholdDb: -20,
  compRatio: 3,
  compAttackMs: 10,
  compReleaseMs: 150,
  makeupDb: 0,
  denoise: false,
}

const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b)

/** Only the fields of `target` that differ from `current`, so micStrip carries just the change. */
export function stripDiff(current: Strip, target: Partial<Strip>): Partial<Strip> {
  const out: Partial<Strip> = {}
  for (const k of Object.keys(target) as (keyof Strip)[]) if (!same(current[k], target[k])) (out as Record<string, unknown>)[k] = target[k]
  return out
}

export function stripPresetMatches(p: StripPreset, s: Strip): boolean {
  return Object.keys(stripDiff(s, p.strip)).length === 0
}

/* ---------- Values ---------- */

/** Rounds to a precision that suits the magnitude: 0.1 below 10, 1 below 1000, else 10. */
function nice(v: number): number {
  const a = Math.abs(v)
  if (a < 10) return Math.round(v * 10) / 10
  if (a < 1000) return Math.round(v)
  return Math.round(v / 10) * 10
}

export function clampStrip(r: StripRange, v: number): number {
  if (!Number.isFinite(v)) return r.min
  const stepped = r.step ? Math.round((v - r.min) / r.step) * r.step + r.min : nice(v)
  return Math.min(r.max, Math.max(r.min, Number(stepped.toFixed(4))))
}

/** Slider position 0..1 for a value; log ranges spread the low end. */
export function stripToSlider(r: StripRange, v: number): number {
  const c = Math.min(r.max, Math.max(r.min, v))
  if (r.log) return Math.log(c / r.min) / Math.log(r.max / r.min)
  return (c - r.min) / (r.max - r.min)
}

export function sliderToStrip(r: StripRange, pos: number): number {
  const p = Math.min(1, Math.max(0, pos))
  const v = r.log ? r.min * (r.max / r.min) ** p : r.min + p * (r.max - r.min)
  return clampStrip(r, v)
}

export function formatStrip(r: StripRange, v: number, lang: string): string {
  const digits = r.unit === ':1' || r.step === 0.5 || (r.log && Math.abs(v) < 10) ? (Number.isInteger(v) ? 0 : 1) : 0
  const n = new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)
  if (r.unit === ':1') return `${n}:1`
  if (r.key === 'makeupDb' && v > 0) return `+${n} dB`
  return `${n} ${r.unit}`
}

/** Short summary of the active stages, as English UI strings or literal values. */
export function stripSummary(s: Strip): string[] {
  const out: string[] = []
  if (s.denoise) out.push('Denoise')
  if (s.hpfHz > 0) out.push(`HPF ${Math.round(s.hpfHz)} Hz`)
  if (s.gate) out.push('Gate')
  if (s.comp) out.push(`Comp ${Number(s.compRatio.toFixed(1))}:1`)
  if (Math.abs(s.makeupDb) >= 0.05) out.push(`${s.makeupDb > 0 ? '+' : ''}${Number(s.makeupDb.toFixed(1))} dB`)
  return out
}

/* ---------- Delay ---------- */

export const DELAY_MAX_MS = 500

/** Lip-sync delay: whole milliseconds, 0..500. */
export function clampDelay(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(DELAY_MAX_MS, Math.max(0, Math.round(v)))
}
