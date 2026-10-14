// LZ Vision Mixer graphics renderer – Electron main process.
//
// Connects to the engine (WebSocket), keeps one offscreen layer window per graphics layer and
// streams their pictures as raw BGRA frames to the engine's frame ports. See docs/api.md,
// "Renderer protocol".

import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { handleScheme, registerScheme, STATUS_URL } from './assets'
import { DEFAULT_FORMAT, type PixelFormat } from './bitmap'
import { calibratePixelFormat } from './calibrate'
import { parseArgs } from './cli'
import { EngineLink } from './engineLink'
import { Layer } from './layer'
import { scanLibrary, type LibraryEntry } from './library'
import { layerMessage, libraryMessage, type EngineMessage, type HelloMessage } from './protocol'
import type { Format, LayerState } from './types'

const opts = parseArgs(process.argv.slice(1))

// The layer pages run third-party OGraf graphics, which may load resources from anywhere, so they
// deliberately have no Content-Security-Policy; silence Electron's development warning about it.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

registerScheme()
// Offscreen windows must keep painting while nothing is visible.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main()
}

function main(): void {
  const bundledDir = app.isPackaged ? path.join(process.resourcesPath, 'graphics') : path.join(app.getAppPath(), 'graphics')
  const userDir = path.join(app.getPath('documents'), 'LZ Vision Mixer', 'Graphics')
  const pagesDir = path.join(__dirname, '..', 'pages')
  const roots = [bundledDir, userDir, ...opts.graphics.map((d) => path.resolve(d))]

  let library: LibraryEntry[] = []
  let warnings: string[] = []
  let layers: Layer[] = []
  let format: Format | null = null
  let pixelFormat: PixelFormat = DEFAULT_FORMAT
  let pixelFormatMeasured = false
  let previewEnabled = Boolean(process.env.LZ_RENDERER_PREVIEW) // development aid; the status window toggles it
  let statusWin: BrowserWindow | null = null
  let tray: Tray | null = null
  let quitting = false

  const engineHost = (() => {
    try {
      return new URL(opts.engine).hostname || '127.0.0.1'
    } catch {
      return '127.0.0.1'
    }
  })()

  const link = new EngineLink(opts.engine, {
    onOpen() {
      log(`connected to ${opts.engine}`)
      link.send(libraryMessage(library.map((e) => e.info)))
      pushStatus()
    },
    onClose() {
      log('engine connection closed, retrying')
      for (const l of layers) l.sink.setTarget(null, null)
      pushStatus()
    },
    onMessage: (msg) => void handle(msg),
    onWarning: (text) => log(text),
  })

  function log(text: string): void {
    console.log(`[renderer] ${text}`)
  }

  async function rescan(): Promise<void> {
    const r = await scanLibrary(roots)
    library = r.entries
    warnings = r.warnings
    for (const w of warnings) log(w)
    link.send(libraryMessage(library.map((e) => e.info)))
    pushStatus()
  }

  function onLayerState(s: LayerState): void {
    link.send(layerMessage(s))
    pushStatus()
  }

  function onPreview(layer: number, dataUrl: string): void {
    if (statusWin && !statusWin.isDestroyed() && statusWin.isVisible()) statusWin.webContents.send('status:preview', { layer, dataUrl })
  }

  function applyHello(h: HelloMessage): void {
    format = h.format
    // Drop layers the engine no longer has, then size/create the rest.
    while (layers.length > h.layers) layers.pop()!.destroy()
    for (const l of layers) l.setFormat(h.format)
    while (layers.length < h.layers) {
      layers.push(new Layer(layers.length + 1, h.format, pixelFormat, onLayerState, onPreview, () => previewEnabled, pushStatus))
    }
    link.layerCount = h.layers
    // A hello starts a fresh engine session: its layers are empty, so ours are cleared too.
    for (const l of layers) {
      void l.run({ type: 'clear' })
      l.sink.setTarget(engineHost, h.framePorts[l.index - 1])
    }
    log(`engine format ${h.format.width}×${h.format.height} @ ${h.format.fps}, ${h.layers} layers, frame ports ${h.framePorts.join(', ')}`)
    pushStatus()
  }

  async function handle(msg: EngineMessage): Promise<void> {
    if (msg.type === 'hello') return applyHello(msg)
    if (msg.type === 'rescan') return rescan()
    const layer = layers[msg.layer - 1]
    if (!layer) return log(`command for layer ${msg.layer} before hello, ignored`)
    switch (msg.type) {
      case 'load': {
        const entry = library.find((e) => e.info.id === msg.graphicId)
        if (!entry) {
          layer.state = { ...layer.state, graphicId: msg.graphicId, status: 'error', step: 0, error: `Unknown graphic "${msg.graphicId}"` }
          onLayerState(layer.state)
          return
        }
        return layer.run({ type: 'load', entry, data: msg.data })
      }
      case 'play':
        return layer.run({ type: 'play', params: msg.params })
      case 'stop':
        return layer.run({ type: 'stop', params: msg.params })
      case 'update':
        return layer.run({ type: 'update', data: msg.data })
      case 'custom':
        return layer.run({ type: 'custom', id: msg.id, payload: msg.payload })
      case 'clear':
        return layer.run({ type: 'clear' })
    }
  }

  // ---- status window -------------------------------------------------------------------------

  function statusSnapshot() {
    return {
      engine: { url: opts.engine, connected: link.connected },
      format,
      pixelFormat: { ...pixelFormat, measured: pixelFormatMeasured },
      layers: layers.map((l) => ({ ...l.state, frames: { ...l.sink.stats } })),
      library: library.map((e) => ({ id: e.info.id, name: e.info.name, description: e.info.description, path: e.info.path, stepCount: e.info.stepCount })),
      warnings,
      roots,
      preview: previewEnabled,
    }
  }

  let pushTimer: NodeJS.Timeout | null = null
  function pushStatus(): void {
    if (pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = null
      if (statusWin && !statusWin.isDestroyed()) statusWin.webContents.send('status:state', statusSnapshot())
    }, 50)
  }

  function showStatus(): void {
    if (statusWin && !statusWin.isDestroyed()) {
      statusWin.show()
      statusWin.focus()
      return
    }
    statusWin = new BrowserWindow({
      width: 460,
      height: process.env.LZ_RENDERER_STATUS_SHOT ? 1100 : 640,
      minWidth: 360,
      minHeight: 420,
      title: 'LZ Vision Mixer Graphics',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1E1F23' : '#FAFAF8',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload-status.js'),
        contextIsolation: true,
        sandbox: true,
      },
    })
    statusWin.on('close', (e) => {
      if (quitting) return
      // Closing the window keeps the renderer running; quit from the tray.
      e.preventDefault()
      statusWin?.hide()
    })
    void statusWin.loadURL(STATUS_URL)
    statusWin.webContents.on('did-finish-load', pushStatus)
    // Development aid: LZ_RENDERER_STATUS_SHOT=<file.png> saves a picture of the status window.
    const shot = process.env.LZ_RENDERER_STATUS_SHOT
    if (shot) {
      setTimeout(async () => {
        const img = await statusWin?.webContents.capturePage()
        if (img) writeFileSync(shot, img.toPNG())
      }, 4000)
    }
  }

  ipcMain.handle('status:get', () => statusSnapshot())
  ipcMain.on('status:preview', (_e, on: boolean) => {
    previewEnabled = Boolean(on)
    for (const l of layers) l.maybePreview(true)
    pushStatus()
  })
  ipcMain.on('status:rescan', () => void rescan())
  ipcMain.on('status:open-folder', () => {
    mkdirSync(userDir, { recursive: true })
    void shell.openPath(userDir)
  })

  if (process.env.LZ_RENDERER_DEBUG) {
    setInterval(() => {
      for (const l of layers) log(`layer ${l.index}: ${l.state.status}, frames sent ${l.sink.stats.sent}, skipped ${l.sink.stats.dropped}, socket ${l.sink.stats.connected ? 'up' : 'down'}`)
    }, 2000)
  }

  setInterval(() => {
    if (statusWin && !statusWin.isDestroyed() && statusWin.isVisible() && layers.length) pushStatus()
  }, 1000)

  function createTray(): void {
    tray = new Tray(trayIcon())
    tray.setToolTip('LZ Vision Mixer Graphics')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: app.getLocale().startsWith('de') ? 'Status anzeigen' : 'Show status', click: showStatus },
        { label: app.getLocale().startsWith('de') ? 'Grafiken neu einlesen' : 'Rescan graphics', click: () => void rescan() },
        { type: 'separator' },
        { label: app.getLocale().startsWith('de') ? 'Beenden' : 'Quit', click: () => app.quit() },
      ]),
    )
    tray.on('click', showStatus)
  }

  app.on('second-instance', showStatus)
  app.on('activate', showStatus)
  app.on('window-all-closed', () => {
    // Keep running: the renderer works without any visible window.
  })
  app.on('before-quit', () => {
    quitting = true
    link.stop()
    for (const l of layers) l.destroy()
  })

  void app.whenReady().then(async () => {
    try {
      mkdirSync(userDir, { recursive: true })
    } catch {
      // read-only Documents: scanning just finds nothing there
    }
    handleScheme(pagesDir, (id) => library.find((e) => e.info.id === id))
    const cal = await calibratePixelFormat()
    pixelFormat = cal.format
    pixelFormatMeasured = cal.measured
    log(
      cal.measured
        ? `pixel format: ${pixelFormat.order}, ${pixelFormat.premultiplied ? 'premultiplied' : 'straight'} alpha (sample ${cal.sample?.join(',')})`
        : `pixel format not measurable (sample ${cal.sample?.join(',') ?? 'none'}), assuming BGRA premultiplied`,
    )
    await rescan()
    createTray()
    if (opts.hidden) app.dock?.hide()
    else showStatus()
    link.start()
  })
}

/** 16 px tray icon drawn in code: the tilted tally square. Template image on macOS. */
function trayIcon(): Electron.NativeImage {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const mac = process.platform === 'darwin'
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // Parallelogram leaning like the signet's dot.
      const shift = Math.round((size - y) * 0.15)
      const inside = y >= 7 && y < 25 && x >= 6 + shift && x < 24 + shift
      if (mac) {
        if (inside) buf.set([0, 0, 0, 255], i)
      } else {
        buf.set(inside ? [0x2e, 0x40, 0xd6, 255] : [0x4f, 0x32, 0x1d, 255], i) // BGRA: tally red on Zumpe Navy
      }
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
  if (mac) img.setTemplateImage(true)
  return img
}
