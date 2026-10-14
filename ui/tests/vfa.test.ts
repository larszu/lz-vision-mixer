import { describe, expect, it } from 'vitest'
import { VFA_DEFAULTS, VFA_PRESETS, VFA_RANGES, clampToRange, formatVfaValue, nextFreeSource, parseSource, presetMatches, speechFill } from '../src/vfa'

describe('VFA presets', () => {
  it('only set timing and levels, all inside the slider ranges', () => {
    for (const p of VFA_PRESETS) {
      expect(Object.keys(p.settings).sort()).toEqual(Object.keys(VFA_DEFAULTS).sort())
      for (const r of VFA_RANGES) {
        const v = p.settings[r.key]
        expect(v === 0 && r.zeroIsOff ? true : v >= r.min && v <= r.max, `${p.id} ${r.key}`).toBe(true)
        expect(clampToRange(r, v)).toBe(v)
      }
    }
  })
  it('have the expected values', () => {
    expect(VFA_PRESETS.map((p) => p.id)).toEqual(['podcast2', 'podcast3', 'panel'])
    expect(VFA_PRESETS[0].settings).toMatchObject({ thresholdDb: -42, dominanceDb: 6, maxShotMs: 0 })
    expect(VFA_PRESETS[2].settings).toMatchObject({ minShotMs: 4000, maxShotMs: 15000 })
  })
  it('are recognised when the current settings match', () => {
    const s = { ...VFA_PRESETS[1].settings }
    expect(presetMatches(VFA_PRESETS[1], s)).toBe(true)
    expect(presetMatches(VFA_PRESETS[0], s)).toBe(false)
    expect(presetMatches(VFA_PRESETS[1], { ...s, attackMs: 450 })).toBe(false)
  })
  it('defaults match the contract', () => {
    expect(VFA_DEFAULTS).toEqual({ thresholdDb: -42, dominanceDb: 6, attackMs: 400, minShotMs: 2500, silenceMs: 2500, maxShotMs: 0, wideBreakMs: 3000 })
  })
})

describe('VFA values', () => {
  const r = (k: string) => VFA_RANGES.find((x) => x.key === k)!
  it('snaps and clamps slider values', () => {
    expect(clampToRange(r('thresholdDb'), -80)).toBe(-70)
    expect(clampToRange(r('dominanceDb'), 6.3)).toBe(6.5)
    expect(clampToRange(r('attackMs'), 420)).toBe(400)
  })
  it('formats with unit and locale', () => {
    expect(formatVfaValue(r('thresholdDb'), -42, 'en', 'Off')).toBe('-42 dB')
    expect(formatVfaValue(r('dominanceDb'), 6.5, 'de', 'Aus')).toBe('6,5 dB')
    expect(formatVfaValue(r('minShotMs'), 2500, 'de', 'Aus')).toBe('2,5 s')
    expect(formatVfaValue(r('attackMs'), 450, 'en', 'Off')).toBe('0.45 s')
    expect(formatVfaValue(r('maxShotMs'), 0, 'en', 'Off')).toBe('Off')
    expect(formatVfaValue(r('maxShotMs'), 20000, 'en', 'Off')).toBe('20 s')
  })
  it('parses sources', () => {
    expect(parseSource('mic:2')).toEqual({ kind: 'mic', n: 2 })
    expect(parseSource('slot:8')).toEqual({ kind: 'slot', n: 8 })
    expect(parseSource('mic:9')).toBeNull()
    expect(parseSource('wide')).toBeNull()
  })
  it('suggests the next unused source, configured mics first', () => {
    expect(nextFreeSource([], [3, 4])).toBe('mic:3')
    expect(nextFreeSource(['mic:3'], [3, 4])).toBe('mic:4')
    expect(nextFreeSource(['mic:3', 'mic:4'], [3, 4])).toBe('mic:1')
  })
  it('maps speech level to bar fill', () => {
    expect(speechFill(-70)).toBe(0)
    expect(speechFill(-10)).toBe(1)
    expect(speechFill(-40)).toBeCloseTo(0.5)
    expect(speechFill(undefined)).toBe(0)
    expect(speechFill(-90)).toBe(0)
  })
})
