// Pixel conversion for frames from Chromium's offscreen renderer. Pure.
//
// NativeImage.toBitmap() hands out Skia's native 32-bit layout: BGRA on little-endian desktop
// platforms, with premultiplied alpha. Rather than trusting that per platform, the renderer paints
// a known colour once at startup and reads the layout back (detectPixelFormat); toStraightBGRA then
// produces what the engine wants: BGRA, straight (not premultiplied) alpha.

export interface PixelFormat {
  order: 'bgra' | 'rgba'
  premultiplied: boolean
}

/** What Skia uses on macOS, Windows and Linux (x64/arm64). Used when calibration fails. */
export const DEFAULT_FORMAT: PixelFormat = { order: 'bgra', premultiplied: true }

/** CSS colour painted for calibration: pure red at 60 % opacity. */
export const CALIBRATION_COLOR = 'rgba(255, 0, 0, 0.6)'
const CAL_ALPHA = 153 // 0.6 × 255

/**
 * Reads the layout from one pixel of the calibration colour. Returns null when the pixel
 * does not look like the calibration colour in any known layout.
 */
export function detectPixelFormat(px: ArrayLike<number>): PixelFormat | null {
  const [b0, b1, b2, a] = [px[0], px[1], px[2], px[3]]
  if (Math.abs(a - CAL_ALPHA) > 6 || b1 > 6) return null
  let order: PixelFormat['order']
  let red: number
  if (b2 > 100 && b0 < 6) {
    order = 'bgra'
    red = b2
  } else if (b0 > 100 && b2 < 6) {
    order = 'rgba'
    red = b0
  } else return null
  // Premultiplied red is ≈ alpha (153), straight red is 255.
  const premultiplied = Math.abs(red - a) < Math.abs(red - 255)
  return { order, premultiplied }
}

let lut: Uint8Array | null = null
/** unpremultiply table: LUT[a * 256 + c] = round(c × 255 / a), clamped. */
function unpremultiplyTable(): Uint8Array {
  if (lut) return lut
  lut = new Uint8Array(256 * 256)
  for (let a = 1; a < 256; a++) {
    for (let c = 0; c < 256; c++) lut[a * 256 + c] = Math.min(255, Math.round((c * 255) / a))
  }
  return lut
}

/**
 * Converts a frame to BGRA with straight alpha. Writes into `out` when given (may be `src`
 * itself), otherwise into a new buffer.
 */
export function toStraightBGRA(src: Uint8Array, fmt: PixelFormat, out?: Uint8Array): Uint8Array {
  const n = src.length - (src.length % 4)
  const dst = out ?? new Uint8Array(src.length)
  const swap = fmt.order === 'rgba'
  if (!fmt.premultiplied && !swap) {
    if (dst !== src) dst.set(src.subarray(0, n))
    return dst
  }
  const t = fmt.premultiplied ? unpremultiplyTable() : null
  for (let i = 0; i < n; i += 4) {
    const a = src[i + 3]
    let c0 = src[i]
    const c1 = src[i + 1]
    let c2 = src[i + 2]
    if (swap) {
      const tmp = c0
      c0 = c2
      c2 = tmp
    }
    if (t && a !== 255) {
      if (a === 0) {
        dst[i] = 0
        dst[i + 1] = 0
        dst[i + 2] = 0
        dst[i + 3] = 0
        continue
      }
      const row = a << 8
      dst[i] = t[row + c0]
      dst[i + 1] = t[row + c1]
      dst[i + 2] = t[row + c2]
    } else {
      dst[i] = c0
      dst[i + 1] = c1
      dst[i + 2] = c2
    }
    dst[i + 3] = a
  }
  return dst
}

/** A fully transparent frame (clears the layer in the engine). */
export function transparentFrame(width: number, height: number): Buffer {
  return Buffer.alloc(width * height * 4)
}
