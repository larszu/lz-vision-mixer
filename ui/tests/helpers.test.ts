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
  areaBox,
  fallbackMultiview,
  keyForSlot,
  mvLayout,
  slotForKey,
  needMet,
  normalizeLevels,
  normalizeState,
  specNeed,
  tallyOf,
  wsUrl,
} from '../src/helpers'

const key = (code: string, shiftKey = false) => ({ code, shiftKey, ctrlKey: false, metaKey: false, altKey: false })

describe('multiview layout', () => {
  it('matches the engine: four columns up to eight inputs', () => {
    const t8 = mvLayout(8)
    expect(t8[0]).toEqual({ x: 0, y: 360, w: 320, h: 180 })
    expect(t8[3]).toEqual({ x: 960, y: 360, w: 320, h: 180 })
    expect(t8[7]).toEqual({ x: 960, y: 540, w: 320, h: 180 })
    expect(mvLayout(1)).toEqual([{ x: 0, y: 360, w: 320, h: 180 }])
    expect(mvLayout(0)).toEqual([])
  })
  it('adds columns until the rows fit the lower half', () => {
    // 9: 5 columns of 256x144, two rows; 12: 6 columns of 213x119.
    expect(mvLayout(9)[5]).toEqual({ x: 0, y: 504, w: 256, h: 144 })
    const t12 = mvLayout(12)
    expect(t12[11]).toEqual({ x: 5 * 213, y: 360 + 119, w: 213, h: 119 })
    for (const n of [9, 12, 20, 33, 64]) {
      const tiles = mvLayout(n)
      expect(tiles).toHaveLength(n)
      for (const a of tiles) {
        expect(a.y + a.h).toBeLessThanOrEqual(720)
        expect(a.x + a.w).toBeLessThanOrEqual(1280)
      }
    }
  })
  it('turns pixel areas into fractions of the picture', () => {
    expect(areaBox({ x: 640, y: 0, w: 640, h: 360 }, { width: 1280, height: 720 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    expect(areaBox({ x: 320, y: 540, w: 320, h: 180 }, { width: 1280, height: 720 })).toEqual({ x: 0.25, y: 0.75, w: 0.25, h: 0.25 })
  })
  it('builds a layout for older engines from the input numbers, gaps included', () => {
    const mv = fallbackMultiview([1, 2, 5])
    expect(mv.tiles.map((x) => x.slot)).toEqual([1, 2, 5])
    expect(mv.tiles[2]).toMatchObject({ x: 640, y: 360 })
    expect(mv.program).toEqual({ x: 640, y: 0, w: 640, h: 360 })
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
  it('maps digits to preview and Shift+digits to program, by list position', () => {
    expect(keyToAction(key('Digit3'))).toEqual({ kind: 'preview', position: 3 })
    expect(keyToAction(key('Digit8', true))).toEqual({ kind: 'program', position: 8 })
    expect(keyToAction(key('Numpad2'))).toEqual({ kind: 'preview', position: 2 })
    expect(keyToAction(key('Digit9'))).toEqual({ kind: 'preview', position: 9 })
    expect(keyToAction(key('Digit0'))).toBeNull()
  })
  it('finds the input for a digit in list order, with gaps in the numbers', () => {
    const slots = [{ slot: 1 }, { slot: 3 }, { slot: 4 }, { slot: 12 }]
    expect(slotForKey(slots, 2)).toBe(3)
    expect(slotForKey(slots, 4)).toBe(12)
    expect(slotForKey(slots, 5)).toBeNull()
    expect(keyForSlot(slots, 12)).toBe(4)
    expect(keyForSlot(slots, 2)).toBeNull()
    const many = Array.from({ length: 12 }, (_, i) => ({ slot: i + 1 }))
    expect(keyForSlot(many, 9)).toBe(9)
    expect(keyForSlot(many, 10)).toBeNull()
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
    expect(specNeed('st2110:/x.sdp')).toBe('st2110')
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
    expect(s.mics).toEqual([])
    expect(s.audioDevices).toEqual([])
    expect(s.videoDevices).toEqual([])
    expect(s.multiview.tiles).toEqual([])
    expect(s.vfa.enabled).toBe(false)
    expect(s.vfa.thresholdDb).toBe(-42)
    expect(s.graphics.layers.map((l) => l.layer)).toEqual([1, 2])
    expect(s.graphics.rendererConnected).toBe(false)
    expect(normalizeLevels({ slots: {}, master: [-90, -90] } as never)).toMatchObject({ mics: {}, speech: {} })
  })
})
