// Finds out how this platform's offscreen bitmaps are laid out (byte order, premultiplied alpha)
// by painting a known colour in a tiny offscreen window and reading one pixel back.

import { BrowserWindow } from 'electron'
import { CALIBRATION_COLOR, DEFAULT_FORMAT, detectPixelFormat, type PixelFormat } from './bitmap'

export async function calibratePixelFormat(timeoutMs = 5000): Promise<{ format: PixelFormat; measured: boolean; sample?: number[] }> {
  const win = new BrowserWindow({
    show: false,
    width: 16,
    height: 16,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: { deviceScaleFactor: 1 }, sandbox: true, contextIsolation: true },
  })
  try {
    return await new Promise((resolve) => {
      let last: number[] | undefined
      const timer = setTimeout(() => resolve({ format: DEFAULT_FORMAT, measured: false, sample: last }), timeoutMs)
      win.webContents.on('paint', (_e, _dirty, image) => {
        const px = image.toBitmap()
        if (px.length < 4) return
        // Middle pixel, away from any edge effects.
        const size = image.getSize()
        const i = ((size.height >> 1) * size.width + (size.width >> 1)) * 4
        last = [px[i], px[i + 1], px[i + 2], px[i + 3]]
        const fmt = detectPixelFormat(last)
        if (fmt) {
          clearTimeout(timer)
          resolve({ format: fmt, measured: true, sample: last })
        }
      })
      const html = `<!doctype html><html><body style="margin:0;background:${CALIBRATION_COLOR}"></body></html>`
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {})
    })
  } finally {
    win.destroy()
  }
}
