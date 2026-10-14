import { describe, expect, it } from 'vitest'
import {
  backoffMs,
  faderToGain,
  formatDb,
  gainToFader,
  gfxHasNext,
  gfxPlayCommand,
  keyToAction,
  meterFill,
  mvSlotBox,
  needMet,
  normalizeLevels,
  normalizeState,
  specNeed,
  tallyOf,
  wsUrl,
} from '../src/helpers'

const key = (code: string, shiftKey = false) => ({ code, shiftKey, ctrlKey: false, metaKey: false, altKey: false })

describe('multiview layout', () => {
  it('places slots in two rows of four in the bottom half', () => {
    expect(mvSlotBox(1)).toEqual({ x: 0, y: 0.5, w: 0.25, h: 0.25 })
    expect(mvSlotBox(4)).toEqual({ x: 0.75, y: 0.5, w: 0.25, h: 0.25 })
    expect(mvSlotBox(5)).toEqual({ x: 0, y: 0.75, w: 0.25, h: 0.25 })
    expect(mvSlotBox(8)).toEqual({ x: 0.75, y: 0.75, w: 0.25, h: 0.25 })
  })
})

describe('fader', () => {
  it('round-trips gain through fader position', () => {
    for (const g of [0.01, 0.1, 0.5, 1, 1.5, 2]) expect(faderToGain(gainToFader(g))).toBeCloseTo(g, 6)
  })
  it('bottom is silence and top never exceeds the API limit', () => {
    expect(faderToGain(0)).toBe(0)
    expect(faderToGain(1)).toBeLessThanOrEqual(2)
    expect(gainToFader(0)).toBe(0)
  })
  it('formats dB', () => {
    expect(formatDb(1)).toBe('0.0')
    expect(formatDb(0)).toBe('-inf')
    expect(formatDb(2)).toBe('+6.0')
  })
})

describe('meter', () => {
  it('maps dBFS to fill', () => {
    expect(meterFill(-90)).toBe(0)
    expect(meterFill(0)).toBe(1)
    expect(meterFill(-30)).toBeCloseTo(0.5)
  })
})

describe('keyboard', () => {
  it('maps digits to preview and Shift+digits to program', () => {
    expect(keyToAction(key('Digit3'))).toEqual({ kind: 'preview', slot: 3 })
    expect(keyToAction(key('Digit8', true))).toEqual({ kind: 'program', slot: 8 })
    expect(keyToAction(key('Numpad2'))).toEqual({ kind: 'preview', slot: 2 })
    expect(keyToAction(key('Digit9'))).toBeNull()
  })
  it('maps Space, Enter and F', () => {
    expect(keyToAction(key('Space'))).toEqual({ kind: 'cut' })
    expect(keyToAction(key('Enter'))).toEqual({ kind: 'auto' })
    expect(keyToAction(key('KeyF'))).toEqual({ kind: 'ftb' })
  })
  it('maps V, G, H and ?', () => {
    expect(keyToAction(key('KeyV'))).toEqual({ kind: 'vfa' })
    expect(keyToAction(key('KeyG'))).toEqual({ kind: 'gfxPlay', layer: 1 })
    expect(keyToAction(key('KeyH'))).toEqual({ kind: 'gfxStop', layer: 1 })
    expect(keyToAction({ ...key('Minus', true), key: '?' })).toEqual({ kind: 'help' })
    expect(keyToAction(key('KeyG', true))).toBeNull()
  })
  it('ignores modified keys', () => {
    expect(keyToAction({ ...key('KeyF'), metaKey: true })).toBeNull()
    expect(keyToAction(key('Space', true))).toBeNull()
  })
})

describe('connection', () => {
  it('backs off up to 8 s', () => {
    expect(backoffMs(0)).toBe(500)
    expect(backoffMs(1)).toBe(1000)
    expect(backoffMs(10)).toBe(8000)
  })
  it('builds the socket URL relative to the page', () => {
    expect(wsUrl('http://127.0.0.1:4195/')).toBe('ws://127.0.0.1:4195/ws')
    expect(wsUrl('https://mixer.local/sub/index.html')).toBe('wss://mixer.local/sub/ws')
  })
})

describe('capabilities', () => {
  const caps = { decklink: false, ndi: true, srt: true, st2110: false, encoders: [] }
  it('checks needs', () => {
    expect(needMet('decklink', caps)).toBe(false)
    expect(needMet('ndi', caps)).toBe(true)
    expect(needMet('encoder', caps)).toBe(false)
    expect(needMet(undefined, caps)).toBe(true)
  })
  it('derives needs from typed specs', () => {
    expect(specNeed('decklink-mv:1')).toBe('decklink')
    expect(specNeed('ndi:Cam')).toBe('ndi')
    expect(specNeed('srt://x:1')).toBe('srt')
    expect(specNeed('test:bars')).toBeUndefined()
  })
})

describe('tally', () => {
  const base = { program: 1, preview: 2, inTransition: false, tbar: 0, ftb: false, overlays: [{ slot: 5, onAir: true }, { slot: 6, onAir: false }] }
  it('marks programme, preview and on-air overlays', () => {
    expect(tallyOf(1, base)).toBe('program')
    expect(tallyOf(2, base)).toBe('preview')
    expect(tallyOf(5, base)).toBe('program')
    expect(tallyOf(6, base)).toBeNull()
  })
  it('puts preview on air while mixing', () => {
    expect(tallyOf(2, { ...base, inTransition: true })).toBe('program')
    expect(tallyOf(2, { ...base, tbar: 0.3 })).toBe('program')
  })
})

describe('graphics play', () => {
  const layer = (status: 'empty' | 'loading' | 'ready' | 'playing' | 'stopped' | 'error', step = 0) => ({
    layer: 1,
    graphicId: 'g',
    data: {},
    status,
    step,
    error: null,
  })
  const info = (stepCount: number) => ({ id: 'g', name: 'G', description: '', path: '', schema: null, stepCount, customActions: [] })
  it('takes a loaded graphic in', () => {
    expect(gfxPlayCommand(layer('ready'), info(1))).toEqual({ cmd: 'gfxPlay', layer: 1 })
    expect(gfxPlayCommand(layer('stopped'), info(3))).toEqual({ cmd: 'gfxPlay', layer: 1 })
  })
  it('advances a multi-step graphic while on air, not a single-step one', () => {
    expect(gfxPlayCommand(layer('playing'), info(3))).toEqual({ cmd: 'gfxPlay', layer: 1, delta: 1 })
    expect(gfxPlayCommand(layer('playing'), info(-1))).toEqual({ cmd: 'gfxPlay', layer: 1, delta: 1 })
    expect(gfxPlayCommand(layer('playing'), info(1))).toBeNull()
  })
  it('does nothing without a usable graphic', () => {
    expect(gfxPlayCommand(layer('loading'), info(1))).toBeNull()
    expect(gfxPlayCommand(layer('error'), info(1))).toBeNull()
    expect(gfxPlayCommand({ ...layer('empty'), graphicId: null }, undefined)).toBeNull()
    expect(gfxPlayCommand(undefined, undefined)).toBeNull()
  })
  it('knows when there is a next step', () => {
    expect(gfxHasNext(layer('playing', 1), info(3))).toBe(true)
    expect(gfxHasNext(layer('playing', 2), info(3))).toBe(false)
    expect(gfxHasNext(layer('playing', 9), info(-1))).toBe(true)
    expect(gfxHasNext(layer('ready'), info(3))).toBe(false)
  })
})

describe('older engines', () => {
  it('fills mics, VFA and graphics when the engine does not send them', () => {
    const s = normalizeState({ version: '0.1.0' } as never)
    expect(s.mics).toHaveLength(8)
    expect(s.audioDevices).toEqual([])
    expect(s.vfa.enabled).toBe(false)
    expect(s.vfa.thresholdDb).toBe(-42)
    expect(s.graphics.layers.map((l) => l.layer)).toEqual([1, 2])
    expect(s.graphics.rendererConnected).toBe(false)
    expect(normalizeLevels({ slots: {}, master: [-90, -90] } as never)).toMatchObject({ mics: {}, speech: {} })
  })
})
