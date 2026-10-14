// One TCP connection per layer to the engine's frame port. Writes raw frames back to back.
// Backpressure: while the socket has not drained, new frames replace the waiting one, so the
// engine always gets the newest picture and never a backlog.

import net from 'node:net'

export interface SinkStats {
  connected: boolean
  sent: number
  dropped: number
}

export class FrameSink {
  private socket: net.Socket | null = null
  private target: { host: string; port: number } | null = null
  private busy = false
  private pending: Buffer | null = null
  private last: Buffer
  private retry: NodeJS.Timeout | null = null
  private backoff = 250
  readonly stats: SinkStats = { connected: false, sent: 0, dropped: 0 }

  constructor(
    private frameSize: number,
    private onChange: () => void = () => {},
  ) {
    this.last = Buffer.alloc(frameSize)
  }

  /** Points the sink at a port (or nowhere). Reconnects when the target changes. */
  setTarget(host: string | null, port: number | null): void {
    const same = this.target && host === this.target.host && port === this.target.port
    if (same) return
    this.disconnect()
    this.target = host && port ? { host, port } : null
    this.backoff = 250
    if (this.target) this.connect()
  }

  /** New frame size (format change): the last frame becomes transparent. */
  resize(frameSize: number): void {
    this.frameSize = frameSize
    this.last = Buffer.alloc(frameSize)
    this.pending = null
  }

  /** Queues a full frame. `frame.length` must equal the frame size. */
  send(frame: Buffer): void {
    if (frame.length !== this.frameSize) return
    this.last = frame
    if (!this.socket || !this.stats.connected) return
    if (this.busy) {
      if (this.pending) this.stats.dropped++
      this.pending = frame
      return
    }
    this.write(frame)
  }

  close(): void {
    this.target = null
    this.disconnect()
  }

  private write(frame: Buffer): void {
    const s = this.socket
    if (!s) return
    this.stats.sent++
    this.busy = !s.write(frame)
  }

  private connect(): void {
    const t = this.target
    if (!t) return
    const s = net.createConnection({ host: t.host, port: t.port })
    this.socket = s
    s.setNoDelay(true)
    s.on('connect', () => {
      this.stats.connected = true
      this.backoff = 250
      this.busy = false
      this.pending = null
      // At least one frame after connecting: the current picture (transparent when the layer is empty).
      this.write(this.last)
      this.onChange()
    })
    s.on('drain', () => {
      this.busy = false
      const next = this.pending
      this.pending = null
      if (next) this.write(next)
    })
    s.on('data', () => {}) // the engine sends nothing on this socket; drain it anyway
    s.on('error', () => {}) // 'close' follows
    s.on('close', () => {
      if (this.socket !== s) return
      const was = this.stats.connected
      this.socket = null
      this.stats.connected = false
      this.busy = false
      this.pending = null
      if (was) this.onChange()
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (!this.target || this.retry) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, 5000)
    this.retry = setTimeout(() => {
      this.retry = null
      if (this.target && !this.socket) this.connect()
    }, delay)
  }

  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const s = this.socket
    this.socket = null
    this.busy = false
    this.pending = null
    if (s) s.destroy()
    if (this.stats.connected) {
      this.stats.connected = false
      this.onChange()
    }
  }
}
