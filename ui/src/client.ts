// One WebSocket to the engine, shared by the whole UI through small stores.
import { useSyncExternalStore } from 'react'
import { backoffMs, wsUrl } from './helpers'
import { t } from './i18n'
import type { Command, Levels, ServerMessage, State } from './types'

export type ConnStatus = 'connecting' | 'open' | 'closed'

export interface Conn {
  status: ConnStatus
  /** When the next reconnect attempt happens (ms epoch), while closed. */
  retryAt: number | null
}

export interface ServerError {
  id: number
  message: string
}

class Store<T> {
  private listeners = new Set<() => void>()
  constructor(private value: T) {}
  get = () => this.value
  set(v: T) {
    this.value = v
    this.listeners.forEach((l) => l())
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

const stateStore = new Store<State | null>(null)
const levelsStore = new Store<Levels | null>(null)
const connStore = new Store<Conn>({ status: 'connecting', retryAt: null })
const errorStore = new Store<ServerError | null>(null)

let ws: WebSocket | null = null
let attempt = 0
let errorId = 0

function reportError(message: string) {
  errorStore.set({ id: ++errorId, message })
}

function connect() {
  connStore.set({ status: 'connecting', retryAt: null })
  const sock = new WebSocket(wsUrl(location.href))
  ws = sock
  sock.onopen = () => connStore.set({ status: 'open', retryAt: null })
  sock.onmessage = (ev) => {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (msg.type === 'state') {
      // Reset the backoff only once the engine really answers; a proxy can accept the socket and drop it.
      attempt = 0
      stateStore.set(msg.state)
    }
    else if (msg.type === 'levels') levelsStore.set(msg.levels)
    else if (msg.type === 'error') reportError(msg.message)
  }
  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    levelsStore.set(null)
    const delay = backoffMs(attempt++)
    connStore.set({ status: 'closed', retryAt: Date.now() + delay })
    setTimeout(connect, delay)
  }
}

export function start() {
  if (!ws) connect()
}

export function send(c: Command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(c))
    return
  }
  // Without the socket, try the HTTP endpoint so a click is not silently lost.
  fetch('api/cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) })
    .then(async (r) => {
      if (!r.ok) reportError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`)
    })
    .catch(() => reportError(t('Not connected to the engine')))
}

export function dismissError() {
  errorStore.set(null)
}

export const useMixerState = () => useSyncExternalStore(stateStore.subscribe, stateStore.get)
export const useLevels = () => useSyncExternalStore(levelsStore.subscribe, levelsStore.get)
export const useConn = () => useSyncExternalStore(connStore.subscribe, connStore.get)
export const useServerError = () => useSyncExternalStore(errorStore.subscribe, errorStore.get)
