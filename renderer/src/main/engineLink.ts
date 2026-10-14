// WebSocket to the engine (ws://127.0.0.1:4195/renderer), reconnecting with backoff.

import WebSocket from 'ws'
import { parseEngineMessage, type EngineMessage } from './protocol'

export interface EngineLinkEvents {
  onOpen(): void
  onClose(): void
  onMessage(msg: EngineMessage): void
  onWarning(text: string): void
}

export class EngineLink {
  private ws: WebSocket | null = null
  private retry: NodeJS.Timeout | null = null
  private backoff = 250
  private stopped = false
  connected = false
  layerCount: number | undefined

  constructor(
    readonly url: string,
    private events: EngineLinkEvents,
  ) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.ws?.terminate()
    this.ws = null
  }

  send(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(text)
  }

  private connect(): void {
    if (this.stopped) return
    const ws = new WebSocket(this.url, { handshakeTimeout: 3000 })
    this.ws = ws
    ws.on('open', () => {
      this.connected = true
      this.backoff = 250
      this.events.onOpen()
    })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      const r = parseEngineMessage(data.toString(), this.layerCount)
      if (r.ok) this.events.onMessage(r.msg)
      else this.events.onWarning(`engine message ignored (${r.error})`)
    })
    ws.on('error', () => {}) // 'close' follows
    ws.on('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.connected) {
        this.connected = false
        this.events.onClose()
      }
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retry) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, 5000)
    this.retry = setTimeout(() => {
      this.retry = null
      this.connect()
    }, delay)
  }
}
