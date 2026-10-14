// One WebSocket to the engine, shared by the whole UI through small stores.
import { useSyncExternalStore } from 'react'
import { backoffMs, normalizeLevels, normalizeState, wsUrl } from './helpers'
import { t } from './i18n'
import type { Command, Levels, Perf, PickKind, ServerMessage, State } from './types'

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
const perfStore = new Store<Perf | null>(null)
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
      stateStore.set(normalizeState(msg.state))
    }
    else if (msg.type === 'levels') levelsStore.set(normalizeLevels(msg.levels))
    else if (msg.type === 'perf') perfStore.set(msg.perf)
    else if (msg.type === 'error') reportError(msg.message)
  }
  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    levelsStore.set(null)
    perfStore.set(null)
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

export type PickResult = { path: string } | { cancelled: true } | { failed: true }

/**
 * Opens the file dialog on the engine's machine (POST /api/pick). Errors go
 * to the toast; the caller only needs to know whether a path came back.
 */
export async function pickPath(kind: PickKind): Promise<PickResult> {
  try {
    const r = await fetch('api/pick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })
    const body = (await r.json().catch(() => null)) as { path?: string; cancelled?: boolean; error?: string } | null
    if (!r.ok) {
      reportError(body?.error ?? `HTTP ${r.status}`)
      return { failed: true }
    }
    if (body?.path) return { path: body.path }
    return { cancelled: true }
  } catch {
    reportError(t('Not connected to the engine'))
    return { failed: true }
  }
}

export function dismissError() {
  errorStore.set(null)
}

/** Current state outside React (keyboard handlers). */
export const getState = () => stateStore.get()

export const useMixerState = () => useSyncExternalStore(stateStore.subscribe, stateStore.get)
export const useLevels = () => useSyncExternalStore(levelsStore.subscribe, levelsStore.get)
export const usePerf = () => useSyncExternalStore(perfStore.subscribe, perfStore.get)
export const useConn = () => useSyncExternalStore(connStore.subscribe, connStore.get)
export const useServerError = () => useSyncExternalStore(errorStore.subscribe, errorStore.get)
