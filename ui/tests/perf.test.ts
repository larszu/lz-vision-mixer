import { beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '../src/i18n'
import { basisLabel, costSentence, fill, forecastSentence, fps, perfTone, roomShort } from '../src/perf'
import type { Perf } from '../src/types'

const perf = (over: Partial<Perf> = {}): Perf => ({
  cpu: 30,
  systemCpu: 42,
  cores: 10,
  memoryUsedMb: 16000,
  memoryTotalMb: 32768,
  processMemoryMb: 1200,
  outputFps: 50,
  nominalFps: 50,
  overloaded: false,
  runningInputs: 6,
  runningMics: 4,
  forecast: { moreInputs: 9, moreMics: 190, perInput: 38.4, perMic: 1.5, basis: 'measured' },
  ...over,
})

describe('load tone', () => {
  it('is fine at full frame rate below the budget', () => {
    expect(perfTone(perf())).toBe('ok')
  })
  it('turns amber on a small dip or a busy machine', () => {
    expect(perfTone(perf({ outputFps: 49.2 }))).toBe('warn')
    expect(perfTone(perf({ systemCpu: 85 }))).toBe('warn')
  })
  it('turns red when frames drop', () => {
    expect(perfTone(perf({ overloaded: true }))).toBe('error')
    expect(perfTone(perf({ outputFps: 44 }))).toBe('error')
  })
})

describe('forecast text', () => {
  beforeEach(() => setLang('en'))
  it('fills templates', () => {
    expect(fill('a {n} b {m}', { n: 1, m: 'x' })).toBe('a 1 b x')
    expect(fill('{missing}', {})).toBe('{missing}')
  })
  it('says how many more fit, with singular and plural', () => {
    expect(forecastSentence(perf().forecast)).toBe('About 9 more inputs and 190 more mics fit.')
    expect(forecastSentence({ ...perf().forecast, moreInputs: 1, moreMics: 1 })).toBe('About 1 more input and 1 more mic fit.')
    expect(forecastSentence({ ...perf().forecast, moreInputs: 0, moreMics: 0 })).toBe('The machine is full: no more inputs or mics fit.')
    expect(forecastSentence({ ...perf().forecast, moreInputs: null })).toBe('No forecast yet.')
  })
  it('states cost and basis', () => {
    expect(costSentence(perf().forecast)).toBe('One input costs about 38.4 % of one core, one mic about 1.5 %.')
    expect(basisLabel(perf().forecast)).toBe('Measured on this machine')
    expect(basisLabel({ ...perf().forecast, basis: 'estimate' })).toBe('Estimate')
  })
  it('gives a short note for the add buttons', () => {
    expect(roomShort(5)).toBe('Room for ~5 more')
    expect(roomShort(0)).toBe('No room for more')
    expect(roomShort(null)).toBeNull()
  })
  it('speaks German', () => {
    setLang('de')
    expect(forecastSentence(perf().forecast)).toBe('Etwa 9 weitere Eingänge und 190 weitere Mikros passen noch.')
    expect(costSentence(perf().forecast)).toBe('Ein Eingang kostet etwa 38,4 % eines Kerns, ein Mikro etwa 1,5 %.')
    expect(roomShort(3)).toBe('Platz für ~3 weitere')
    expect(fps(59.94)).toBe('59,94')
    setLang('en')
    expect(fps(59.94)).toBe('59.94')
    expect(fps(50)).toBe('50')
  })
})
