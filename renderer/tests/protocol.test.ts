import { describe, expect, it } from 'vitest'
import { frameBytes, layerMessage, libraryMessage, paintRate, parseEngineMessage } from '../src/main/protocol'

const parse = (o: unknown, layers?: number) => parseEngineMessage(JSON.stringify(o), layers)

describe('parseEngineMessage', () => {
  it('reads hello', () => {
    expect(parse({ type: 'hello', format: { width: 1920, height: 1080, fps: 50 }, layers: 2, framePorts: [4198, 4199] })).toEqual({
      ok: true,
      msg: { type: 'hello', format: { width: 1920, height: 1080, fps: 50 }, layers: 2, framePorts: [4198, 4199] },
    })
  })
  it('rejects a hello with a broken format or too few ports', () => {
    expect(parse({ type: 'hello', format: { width: 0, height: 1080, fps: 50 }, layers: 2, framePorts: [1, 2] }).ok).toBe(false)
    expect(parse({ type: 'hello', format: { width: 1920, height: 1080, fps: 50 }, layers: 2, framePorts: [4198] }).ok).toBe(false)
  })
  it('reads load with data and defaults missing data to {}', () => {
    expect(parse({ type: 'load', layer: 1, graphicId: 'lz-bug', data: { text: 'x' } })).toEqual({
      ok: true,
      msg: { type: 'load', layer: 1, graphicId: 'lz-bug', data: { text: 'x' } },
    })
    expect(parse({ type: 'load', layer: 2, graphicId: 'lz-bug' })).toMatchObject({ ok: true, msg: { data: {} } })
  })
  it('passes play params on unchanged, without undefined keys', () => {
    expect(parse({ type: 'play', layer: 1, params: { delta: 1 } })).toEqual({ ok: true, msg: { type: 'play', layer: 1, params: { delta: 1 } } })
    expect(parse({ type: 'play', layer: 1, params: { goto: 2, skipAnimation: true } })).toEqual({
      ok: true,
      msg: { type: 'play', layer: 1, params: { goto: 2, skipAnimation: true } },
    })
    expect(parse({ type: 'play', layer: 1 })).toEqual({ ok: true, msg: { type: 'play', layer: 1, params: {} } })
  })
  it('reads stop, update, custom, clear and rescan', () => {
    expect(parse({ type: 'stop', layer: 2, params: { skipAnimation: true } })).toMatchObject({ ok: true, msg: { params: { skipAnimation: true } } })
    expect(parse({ type: 'update', layer: 1, data: { name: 'A' } })).toMatchObject({ ok: true, msg: { type: 'update', data: { name: 'A' } } })
    expect(parse({ type: 'custom', layer: 1, id: 'blank', payload: { blank: true } })).toMatchObject({
      ok: true,
      msg: { type: 'custom', id: 'blank', payload: { blank: true } },
    })
    expect(parse({ type: 'clear', layer: 1 })).toEqual({ ok: true, msg: { type: 'clear', layer: 1 } })
    expect(parse({ type: 'rescan' })).toEqual({ ok: true, msg: { type: 'rescan' } })
  })
  it('checks layer numbers against the hello', () => {
    expect(parse({ type: 'clear', layer: 3 }, 2).ok).toBe(false)
    expect(parse({ type: 'clear', layer: 0 }).ok).toBe(false)
    expect(parse({ type: 'clear', layer: 2 }, 2).ok).toBe(true)
  })
  it('rejects junk', () => {
    expect(parseEngineMessage('not json').ok).toBe(false)
    expect(parse({ layer: 1 }).ok).toBe(false)
    expect(parse({ type: 'dance', layer: 1 }).ok).toBe(false)
    expect(parse({ type: 'load', layer: 1 }).ok).toBe(false)
  })
})

describe('messages to the engine', () => {
  it('builds library', () => {
    const g = { id: 'a', name: 'A', description: '', path: '/x', schema: null, stepCount: 1, customActions: [] }
    expect(JSON.parse(libraryMessage([g]))).toEqual({ type: 'library', graphics: [g] })
  })
  it('builds layer with exactly the documented fields', () => {
    const msg = JSON.parse(layerMessage({ layer: 1, graphicId: 'a', status: 'playing', step: 2, error: null }))
    expect(msg).toEqual({ type: 'layer', layer: 1, graphicId: 'a', status: 'playing', step: 2, error: null })
  })
})

describe('frame helpers', () => {
  it('frame size is width × height × 4', () => {
    expect(frameBytes({ width: 1920, height: 1080 })).toBe(8294400)
  })
  it('paint rate follows the engine, whole frames, max 60', () => {
    expect(paintRate(50)).toBe(50)
    expect(paintRate(59.94)).toBe(60)
    expect(paintRate(29.97)).toBe(30)
    expect(paintRate(25)).toBe(25)
    expect(paintRate(120)).toBe(60)
  })
})
