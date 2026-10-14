import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMAT, detectPixelFormat, toStraightBGRA, transparentFrame } from '../src/main/bitmap'

describe('detectPixelFormat', () => {
  it('recognises premultiplied BGRA (Skia on macOS/Windows/Linux)', () => {
    expect(detectPixelFormat([0, 0, 153, 153])).toEqual({ order: 'bgra', premultiplied: true })
  })
  it('recognises straight BGRA', () => {
    expect(detectPixelFormat([0, 0, 255, 153])).toEqual({ order: 'bgra', premultiplied: false })
  })
  it('recognises premultiplied and straight RGBA', () => {
    expect(detectPixelFormat([153, 0, 0, 153])).toEqual({ order: 'rgba', premultiplied: true })
    expect(detectPixelFormat([255, 0, 0, 154])).toEqual({ order: 'rgba', premultiplied: false })
  })
  it('rejects pixels that are not the calibration colour', () => {
    expect(detectPixelFormat([0, 0, 0, 0])).toBeNull()
    expect(detectPixelFormat([0, 0, 255, 255])).toBeNull()
    expect(detectPixelFormat([80, 80, 80, 153])).toBeNull()
  })
})

describe('toStraightBGRA', () => {
  it('un-premultiplies colour channels and keeps alpha', () => {
    // 50 % navy (#1D324F) premultiplied: B 0x4F*.5, G 0x32*.5, R 0x1D*.5, A 128
    const src = new Uint8Array([40, 25, 15, 128])
    const out = toStraightBGRA(src, DEFAULT_FORMAT)
    expect(Array.from(out)).toEqual([80, 50, 30, 128])
  })
  it('leaves opaque pixels alone and zeroes fully transparent ones', () => {
    const src = new Uint8Array([10, 20, 30, 255, 7, 8, 9, 0])
    expect(Array.from(toStraightBGRA(src, DEFAULT_FORMAT))).toEqual([10, 20, 30, 255, 0, 0, 0, 0])
  })
  it('clamps channels that exceed alpha (rounding noise in premultiplied data)', () => {
    expect(Array.from(toStraightBGRA(new Uint8Array([200, 0, 0, 100]), DEFAULT_FORMAT))).toEqual([255, 0, 0, 100])
  })
  it('swaps RGBA to BGRA', () => {
    const src = new Uint8Array([1, 2, 3, 255])
    expect(Array.from(toStraightBGRA(src, { order: 'rgba', premultiplied: false }))).toEqual([3, 2, 1, 255])
    expect(Array.from(toStraightBGRA(new Uint8Array([64, 32, 0, 128]), { order: 'rgba', premultiplied: true }))).toEqual([0, 64, 128, 128])
  })
  it('passes straight BGRA through unchanged', () => {
    const src = new Uint8Array([1, 2, 3, 4])
    expect(Array.from(toStraightBGRA(src, { order: 'bgra', premultiplied: false }))).toEqual([1, 2, 3, 4])
  })
  it('converts in place', () => {
    const buf = new Uint8Array([40, 25, 15, 128])
    const out = toStraightBGRA(buf, DEFAULT_FORMAT, buf)
    expect(out).toBe(buf)
    expect(Array.from(buf)).toEqual([80, 50, 30, 128])
  })
  it('round-trips straight → premultiplied → straight within one step', () => {
    for (let a = 1; a < 256; a += 7) {
      for (let c = 0; c < 256; c += 5) {
        const pre = Math.round((c * a) / 255)
        const [back] = toStraightBGRA(new Uint8Array([pre, 0, 0, a]), DEFAULT_FORMAT)
        expect(Math.abs(back - c)).toBeLessThanOrEqual(Math.ceil(255 / a / 2) + 1)
      }
    }
  })
  it('converts a 1080p frame fast enough for 50 fps', () => {
    const frame = new Uint8Array(1920 * 1080 * 4)
    for (let i = 0; i < frame.length; i += 4) frame[i + 3] = i % 3 ? 128 : 0
    const t0 = performance.now()
    toStraightBGRA(frame, DEFAULT_FORMAT, frame)
    expect(performance.now() - t0).toBeLessThan(100)
  })
})

describe('transparentFrame', () => {
  it('is width × height × 4 zero bytes', () => {
    const f = transparentFrame(4, 2)
    expect(f.length).toBe(32)
    expect(f.every((b) => b === 0)).toBe(true)
  })
})
