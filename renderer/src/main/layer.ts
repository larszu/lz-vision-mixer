// One graphics layer: an offscreen, transparent BrowserWindow running the OGraf host page.
// Every 'paint' becomes a straight-alpha BGRA frame for the layer's FrameSink.

import { BrowserWindow, type NativeImage } from 'electron'
import { toStraightBGRA, type PixelFormat } from './bitmap'
import { FrameSink } from './frameSink'
import { frameBytes, paintRate } from './protocol'
import type { Format, LayerState, PlayParams, StopParams } from './types'
import type { LibraryEntry } from './library'
import { elementName, schemaDefaults } from './library'
import { graphicUrl, HOST_URL } from './assets'

interface HostResult {
  statusCode: number
  statusMessage?: string
  hasStep: boolean
  currentStep?: number
}

const DEBUG = Boolean(process.env.LZ_RENDERER_DEBUG)

export type LayerCommand =
  | { type: 'load'; entry: LibraryEntry; data: Record<string, unknown> }
  | { type: 'play'; params: PlayParams }
  | { type: 'stop'; params: StopParams }
  | { type: 'update'; data: Record<string, unknown> }
  | { type: 'custom'; id: string; payload: unknown }
  | { type: 'clear' }

export class Layer {
  readonly sink: FrameSink
  state: LayerState
  private win: BrowserWindow | null = null
  private ready: Promise<void> = Promise.resolve()
  private lastImage: NativeImage | null = null
  private previewAt = 0
  private previewTimer: NodeJS.Timeout | null = null
  /** Increments on load/clear, so a late result of an older graphic does not overwrite newer state. */
  private generation = 0

  constructor(
    readonly index: number,
    private format: Format,
    private pixelFormat: PixelFormat,
    private onState: (s: LayerState) => void,
    private onPreview: (layer: number, dataUrl: string) => void,
    private previewEnabled: () => boolean,
    onSinkChange: () => void,
  ) {
    this.state = { layer: index, graphicId: null, status: 'empty', step: 0, error: null }
    this.sink = new FrameSink(frameBytes(format), onSinkChange)
    this.createWindow()
  }

  private createWindow(): void {
    const { width, height } = this.format
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      enableLargerThanScreen: true,
      webPreferences: {
        offscreen: { deviceScaleFactor: 1 },
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    this.win = win
    win.setContentSize(width, height)
    win.webContents.setFrameRate(paintRate(this.format.fps))
    win.webContents.setAudioMuted(true)
    win.webContents.on('paint', (_e, _dirty, image) => this.onPaint(image))
    win.webContents.on('render-process-gone', (_e, details) => {
      this.setState({ status: 'error', error: `renderer process gone (${details.reason})` })
      this.ready = this.loadHost()
    })
    win.webContents.on('console-message', (e) => {
      const level = (e as unknown as { level?: string }).level
      if (level === 'error' || level === 'warning') console.log(`[layer ${this.index}] ${(e as unknown as { message: string }).message}`)
    })
    this.ready = this.loadHost()
  }

  private async loadHost(): Promise<void> {
    const win = this.win
    if (!win) return
    await win.loadURL(HOST_URL)
    win.webContents.startPainting()
  }

  /** Format change from the engine: new window size and frame rate, graphic is dropped. */
  setFormat(format: Format): void {
    const resized = format.width !== this.format.width || format.height !== this.format.height
    this.format = format
    if (resized) {
      this.generation++
      this.sink.resize(frameBytes(format))
      this.lastImage = null
      this.win?.destroy()
      this.createWindow()
      this.setState({ graphicId: null, status: 'empty', step: 0, error: null })
    } else {
      this.win?.webContents.setFrameRate(paintRate(format.fps))
    }
  }

  setPixelFormat(fmt: PixelFormat): void {
    this.pixelFormat = fmt
  }

  destroy(): void {
    this.sink.close()
    this.win?.destroy()
    this.win = null
  }

  private paintStats = { n: 0, ms: 0, since: Date.now() }

  private onPaint(image: NativeImage): void {
    const t0 = performance.now()
    this.handlePaint(image)
    if (DEBUG) {
      const st = this.paintStats
      st.n++
      st.ms += performance.now() - t0
      if (Date.now() - st.since >= 1000) {
        console.log(`[layer ${this.index}] ${st.n} paints/s, ${(st.ms / st.n).toFixed(1)} ms each, sent ${this.sink.stats.sent}, dropped ${this.sink.stats.dropped}`)
        this.paintStats = { n: 0, ms: 0, since: Date.now() }
      }
    }
  }

  private handlePaint(image: NativeImage): void {
    const { width, height } = this.format
    let img = image
    const size = img.getSize()
    if (size.width !== width || size.height !== height) img = img.resize({ width, height, quality: 'best' })
    const raw = img.toBitmap()
    if (raw.length !== frameBytes(this.format)) return
    // toBitmap() returns a fresh copy, so convert in place.
    toStraightBGRA(raw, this.pixelFormat, raw)
    this.sink.send(raw)
    this.lastImage = img
    this.maybePreview()
  }

  /** Sends a downscaled picture to the status window, at most five times a second. */
  maybePreview(force = false): void {
    if (!this.previewEnabled() || !this.lastImage) return
    const wait = 200 - (Date.now() - this.previewAt)
    if (!force && wait > 0) {
      // Throttled: send the newest picture once the window has passed, so the last frame of an animation is shown.
      this.previewTimer ??= setTimeout(() => {
        this.previewTimer = null
        this.maybePreview(true)
      }, wait)
      return
    }
    this.previewAt = Date.now()
    this.onPreview(this.index, this.lastImage.resize({ width: 384 }).toDataURL())
  }

  private setState(patch: Partial<LayerState>): void {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }

  private async host(cmd: object): Promise<HostResult> {
    await this.ready
    const win = this.win
    if (!win) return { statusCode: 503, statusMessage: 'layer window gone', hasStep: false }
    try {
      return (await win.webContents.executeJavaScript(`window.__ografHost.run(${JSON.stringify(cmd)})`, true)) as HostResult
    } catch (e) {
      return { statusCode: 500, statusMessage: (e as Error).message, hasStep: false }
    }
  }

  private renderCharacteristics() {
    return {
      resolution: { width: this.format.width, height: this.format.height },
      frameRate: this.format.fps,
    }
  }

  async run(cmd: LayerCommand): Promise<void> {
    switch (cmd.type) {
      case 'load': {
        const gen = ++this.generation
        const { entry } = cmd
        this.setState({ graphicId: entry.info.id, status: 'loading', step: 0, error: null })
        // Schema defaults first, so a graphic gets a complete state even from a bare gfxLoad.
        const data = { ...schemaDefaults(entry.info.schema), ...cmd.data }
        const r = await this.host({
          op: 'load',
          moduleUrl: `${graphicUrl(entry.info.id, entry.main)}?rev=${encodeURIComponent(entry.revision)}`,
          tag: elementName(entry.info.id, entry.revision),
          data,
          renderCharacteristics: this.renderCharacteristics(),
        })
        if (gen !== this.generation) return
        if (r.statusCode >= 400) this.setState({ graphicId: entry.info.id, status: 'error', error: message(r) })
        else this.setState({ graphicId: entry.info.id, status: 'ready', step: 0, error: null })
        return
      }
      case 'clear': {
        const gen = ++this.generation
        await this.host({ op: 'clear' })
        if (gen !== this.generation) return // a newer load has taken over
        this.setState({ graphicId: null, status: 'empty', step: 0, error: null })
        this.win?.webContents.invalidate()
        return
      }
      default:
        return this.action(cmd)
    }
  }

  private async action(cmd: Exclude<LayerCommand, { type: 'load' | 'clear' }>): Promise<void> {
    const gen = this.generation
    if (!this.state.graphicId) {
      this.setState({ error: 'No graphic loaded' })
      return
    }
    let r: HostResult
    switch (cmd.type) {
      case 'play':
        r = await this.host({ op: 'play', params: cmd.params })
        break
      case 'stop':
        r = await this.host({ op: 'stop', params: cmd.params })
        break
      case 'update':
        r = await this.host({ op: 'update', data: cmd.data })
        break
      case 'custom':
        r = await this.host({ op: 'custom', id: cmd.id, payload: cmd.payload })
        break
    }
    if (gen !== this.generation) return
    if (r.statusCode >= 400) {
      this.setState({ error: message(r) })
      return
    }
    const patch: Partial<LayerState> = { error: null }
    if (cmd.type === 'play') {
      // currentStep undefined after playAction = the graphic went to its end (OGraf v1 step model).
      if (r.currentStep === undefined) Object.assign(patch, { status: 'stopped', step: 0 })
      else Object.assign(patch, { status: 'playing', step: r.currentStep })
    } else if (cmd.type === 'stop') {
      Object.assign(patch, { status: 'stopped', step: 0 })
    } else if (r.hasStep) {
      if (r.currentStep === undefined) {
        if (this.state.status === 'playing') Object.assign(patch, { status: 'stopped', step: 0 })
      } else Object.assign(patch, { step: r.currentStep })
    }
    this.setState(patch)
  }
}

function message(r: HostResult): string {
  return r.statusMessage ? `${r.statusMessage} (${r.statusCode})` : `status ${r.statusCode}`
}
