import { describe, expect, it } from 'vitest'
import { normalizeState } from '../src/helpers'
import {
  clampDelay,
  clampStrip,
  formatStrip,
  HPF_STEPS,
  sliderToStrip,
  STRIP_NEUTRAL,
  STRIP_PRESETS,
  STRIP_RANGES,
  stripDiff,
  stripPresetMatches,
  stripSummary,
  stripToSlider,
} from '../src/strip'

const preset = (id: string) => STRIP_PRESETS.find((p) => p.id === id)!

describe('strip presets', () => {
  it('speech has the podcast values', () => {
    expect(preset('speech').strip).toEqual({
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
    })
  })
  it('off switches every stage off', () => {
    expect(preset('off').strip).toEqual({ denoise: false, hpfHz: 0, gate: false, comp: false, makeupDb: 0 })
    expect(stripPresetMatches(preset('off'), STRIP_NEUTRAL)).toBe(true)
  })
  it('numbers stay inside the contract ranges', () => {
    for (const p of STRIP_PRESETS)
      for (const [k, v] of Object.entries(p.strip)) {
        const r = STRIP_RANGES[k as keyof typeof STRIP_RANGES]
        if (!r || typeof v !== 'number' || (k === 'hpfHz' && v === 0)) continue
        expect(v, `${p.id} ${k}`).toBeGreaterThanOrEqual(r.min)
        expect(v, `${p.id} ${k}`).toBeLessThanOrEqual(r.max)
        expect(clampStrip(r, v)).toBe(v)
      }
  })
  it('send only the fields that change', () => {
    const s = { ...STRIP_NEUTRAL, hpfHz: 80, gate: true }
    expect(stripDiff(s, preset('off').strip)).toEqual({ hpfHz: 0, gate: false })
    expect(stripDiff(s, { gate: true })).toEqual({})
    const speech = { ...STRIP_NEUTRAL, ...preset('speech').strip }
    expect(stripPresetMatches(preset('speech'), speech)).toBe(true)
    expect(stripPresetMatches(preset('speech'), { ...speech, compRatio: 4 })).toBe(false)
    expect(stripDiff(speech, preset('speech').strip)).toEqual({})
  })
  it('high-pass quick picks', () => {
    expect(HPF_STEPS).toEqual([0, 60, 80, 100, 120])
  })
})

describe('strip values', () => {
  it('clamps and snaps', () => {
    expect(clampStrip(STRIP_RANGES.compRatio, 3.2)).toBe(3)
    expect(clampStrip(STRIP_RANGES.compRatio, 50)).toBe(20)
    expect(clampStrip(STRIP_RANGES.gateThresholdDb, -120)).toBe(-90)
    expect(clampStrip(STRIP_RANGES.compAttackMs, 0.01)).toBe(0.1)
    expect(clampStrip(STRIP_RANGES.compAttackMs, 3.14)).toBe(3.1)
    expect(clampStrip(STRIP_RANGES.compReleaseMs, 1234)).toBe(1230)
    expect(clampStrip(STRIP_RANGES.makeupDb, NaN)).toBe(-20)
  })
  it('maps log ranges to slider travel and back', () => {
    const hpf = STRIP_RANGES.hpfHz
    expect(stripToSlider(hpf, 20)).toBe(0)
    expect(stripToSlider(hpf, 400)).toBe(1)
    expect(stripToSlider(hpf, 0)).toBe(0)
    expect(sliderToStrip(hpf, 0.5)).toBe(89) // geometric middle of 20 and 400
    for (const v of [20, 80, 120, 400]) expect(sliderToStrip(hpf, stripToSlider(hpf, v))).toBe(v)
    expect(stripToSlider(STRIP_RANGES.makeupDb, 2)).toBeCloseTo(0.5)
  })
  it('formats with unit and locale', () => {
    expect(formatStrip(STRIP_RANGES.hpfHz, 80, 'en')).toBe('80 Hz')
    expect(formatStrip(STRIP_RANGES.compRatio, 3, 'en')).toBe('3:1')
    expect(formatStrip(STRIP_RANGES.compRatio, 2.5, 'de')).toBe('2,5:1')
    expect(formatStrip(STRIP_RANGES.makeupDb, 3, 'en')).toBe('+3 dB')
    expect(formatStrip(STRIP_RANGES.compAttackMs, 0.5, 'de')).toBe('0,5 ms')
    expect(formatStrip(STRIP_RANGES.gateThresholdDb, -50, 'en')).toBe('-50 dB')
  })
  it('summarises the active stages', () => {
    expect(stripSummary(STRIP_NEUTRAL)).toEqual([])
    expect(stripSummary({ ...STRIP_NEUTRAL, ...preset('speech').strip })).toEqual(['Denoise', 'HPF 80 Hz', 'Gate', 'Comp 3:1', '+3 dB'])
  })
})

describe('delay', () => {
  it('clamps to whole ms in 0..500', () => {
    expect(clampDelay(-5)).toBe(0)
    expect(clampDelay(40.6)).toBe(41)
    expect(clampDelay(900)).toBe(500)
    expect(clampDelay(Number.NaN)).toBe(0)
  })
  it('older engines get no delay and a neutral strip', () => {
    const s = normalizeState({
      version: '0.1.0',
      slots: [{ slot: 1, audio: { volume: 1, muted: false, afv: true } }],
      mics: [{ mic: 1, name: '', device: null, channel: 0, status: 'empty', error: null, volume: 1, muted: false, inProgram: true }],
    } as never)
    expect(s.slots[0].audio.delayMs).toBe(0)
    expect(s.mics[0].delayMs).toBe(0)
    expect(s.mics[0].strip).toEqual(STRIP_NEUTRAL)
    expect(s.audioOutputs).toEqual([])
    expect(s.osc).toEqual({ listen: null, targets: [] })
  })
})
