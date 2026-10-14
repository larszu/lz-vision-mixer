// Video follows audio: pure helpers (no DOM), unit-tested.
import type { VfaSettings } from './types'

export type VfaKey = keyof VfaSettings

export interface VfaRange {
  key: VfaKey
  label: string
  hint: string
  min: number
  max: number
  step: number
  unit: 'dB' | 's'
  /** 0 means off (only maxShotMs). */
  zeroIsOff?: boolean
}

/** Slider ranges. Times are stored in ms and shown in seconds. */
export const VFA_RANGES: VfaRange[] = [
  { key: 'thresholdDb', label: 'Threshold', hint: 'Speech below this level is ignored', min: -70, max: -10, step: 1, unit: 'dB' },
  { key: 'dominanceDb', label: 'Dominance', hint: 'How much louder than everyone else a speaker must be', min: 0, max: 20, step: 0.5, unit: 'dB' },
  { key: 'attackMs', label: 'Attack', hint: 'How long someone must speak before the cut', min: 0, max: 2000, step: 50, unit: 's' },
  { key: 'minShotMs', label: 'Minimum shot', hint: 'A shot stays at least this long', min: 0, max: 10000, step: 100, unit: 's' },
  { key: 'silenceMs', label: 'Silence to wide', hint: 'Silence this long goes to the wide shot', min: 500, max: 10000, step: 100, unit: 's' },
  { key: 'maxShotMs', label: 'Maximum shot', hint: 'A single speaker this long gets a wide break', min: 0, max: 60000, step: 1000, unit: 's', zeroIsOff: true },
  { key: 'wideBreakMs', label: 'Wide break', hint: 'How long the wide break lasts', min: 500, max: 10000, step: 100, unit: 's' },
]

export const VFA_DEFAULTS: VfaSettings = {
  thresholdDb: -42,
  dominanceDb: 6,
  attackMs: 400,
  minShotMs: 2500,
  silenceMs: 2500,
  maxShotMs: 0,
  wideBreakMs: 3000,
}

export interface VfaPreset {
  id: string
  label: string
  settings: VfaSettings
}

/** Presets only set the timing and levels; the rules stay as they are. */
export const VFA_PRESETS: VfaPreset[] = [
  {
    id: 'podcast2',
    label: 'Podcast 2 people',
    settings: { thresholdDb: -42, dominanceDb: 6, attackMs: 400, minShotMs: 2500, silenceMs: 3000, maxShotMs: 0, wideBreakMs: 3000 },
  },
  {
    id: 'podcast3',
    label: 'Podcast 3 people',
    settings: { thresholdDb: -42, dominanceDb: 5, attackMs: 500, minShotMs: 3000, silenceMs: 2500, maxShotMs: 20000, wideBreakMs: 3000 },
  },
  {
    id: 'panel',
    label: 'Panel',
    settings: { thresholdDb: -45, dominanceDb: 4, attackMs: 700, minShotMs: 4000, silenceMs: 2000, maxShotMs: 15000, wideBreakMs: 4000 },
  },
]

export function presetMatches(p: VfaPreset, s: VfaSettings): boolean {
  return (Object.keys(p.settings) as VfaKey[]).every((k) => Math.abs(p.settings[k] - s[k]) < 1e-6)
}

export function clampToRange(r: VfaRange, v: number): number {
  const stepped = Math.round((v - r.min) / r.step) * r.step + r.min
  return Math.min(r.max, Math.max(r.min, Number(stepped.toFixed(4))))
}

export function formatVfaValue(r: VfaRange, v: number, lang: string, offLabel: string): string {
  if (r.zeroIsOff && v === 0) return offLabel
  const nf = (digits: number) => new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (r.unit === 's') return `${nf(v % 1000 === 0 ? 0 : v % 100 === 0 ? 1 : 2).format(v / 1000)} s`
  return `${nf(Number.isInteger(r.step) ? 0 : 1).format(v)} dB`
}

/* ---------- Sources ---------- */

export type VfaSource = { kind: 'slot' | 'mic'; n: number }

export function parseSource(s: string): VfaSource | null {
  const m = /^(slot|mic):([1-8])$/.exec(s)
  return m ? { kind: m[1] as 'slot' | 'mic', n: Number(m[2]) } : null
}

export const sourceKey = (src: VfaSource) => `${src.kind}:${src.n}`

/** First source not used by a rule yet: mics first, since VFA is mostly fed by mics. */
export function nextFreeSource(used: string[], micsInUse: number[]): string {
  for (const n of micsInUse) if (!used.includes(`mic:${n}`)) return `mic:${n}`
  for (let n = 1; n <= 8; n++) if (!used.includes(`mic:${n}`)) return `mic:${n}`
  for (let n = 1; n <= 8; n++) if (!used.includes(`slot:${n}`)) return `slot:${n}`
  return 'mic:1'
}

/** Fill 0..1 of a speech bar from -70 to -10 dBFS (the threshold range). */
export function speechFill(db: number | undefined): number {
  if (db == null || !Number.isFinite(db)) return 0
  return Math.min(1, Math.max(0, (db + 70) / 60))
}
