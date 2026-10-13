// Mirrors docs/api.md. Keep in sync with the engine.
import type { Easing } from './easing'

export type { EaseFamily, EaseDirection, Easing } from './easing'

export type TransitionKind = 'cut' | 'mix' | 'dip' | 'pushLeft' | 'pushRight' | 'slideLeft' | 'slideRight' | 'zoom'
export type OverlayTransition = 'cut' | 'fade' | 'flyLeft' | 'flyRight' | 'flyTop' | 'flyBottom' | 'zoom'

export interface Format {
  width: number
  height: number
  fps: number
  name: string
}

export interface Slot {
  slot: number
  name: string
  spec: string | null
  status: 'empty' | 'starting' | 'running' | 'error'
  error: string | null
  audio: { volume: number; muted: boolean; afv: boolean }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Overlay {
  index: number
  slot: number | null
  onAir: boolean
  rect: Rect
  transition: OverlayTransition
  durationMs: number
}

export interface Output {
  id: string
  spec: string
  status: 'starting' | 'running' | 'error'
  error: string | null
}

export interface Capabilities {
  decklink: boolean
  ndi: boolean
  srt: boolean
  st2110: boolean
  encoders: string[]
}

export interface State {
  version: string
  format: Format
  slots: Slot[]
  program: number | null
  preview: number | null
  transition: { kind: TransitionKind; durationMs: number; easing: Easing }
  inTransition: boolean
  tbar: number
  ftb: boolean
  overlays: Overlay[]
  outputs: Output[]
  master: { volume: number; muted: boolean }
  capabilities: Capabilities
}

export interface Levels {
  slots: Record<number, [number, number]>
  master: [number, number]
}

export type Command =
  | { cmd: 'setInput'; slot: number; spec: string; name?: string }
  | { cmd: 'clearInput'; slot: number }
  | { cmd: 'renameInput'; slot: number; name: string }
  | { cmd: 'preview'; slot: number }
  | { cmd: 'program'; slot: number }
  | { cmd: 'cut' }
  | { cmd: 'auto' }
  | { cmd: 'setTransition'; kind?: TransitionKind; durationMs?: number; easing?: Easing }
  | { cmd: 'tbar'; value: number }
  | { cmd: 'ftb' }
  | { cmd: 'overlay'; index: number; slot?: number | null; rect?: Rect; transition?: OverlayTransition; durationMs?: number }
  | { cmd: 'overlayOn'; index: number; on: boolean }
  | { cmd: 'audio'; slot: number; volume?: number; muted?: boolean; afv?: boolean }
  | { cmd: 'master'; volume?: number; muted?: boolean }
  | { cmd: 'addOutput'; spec: string }
  | { cmd: 'removeOutput'; id: string }

export type ServerMessage =
  | { type: 'state'; state: State }
  | { type: 'levels'; levels: Levels }
  | { type: 'error'; message: string }

export const TRANSITION_KINDS: TransitionKind[] = ['cut', 'mix', 'dip', 'pushLeft', 'pushRight', 'slideLeft', 'slideRight', 'zoom']
export const OVERLAY_TRANSITIONS: OverlayTransition[] = ['cut', 'fade', 'flyLeft', 'flyRight', 'flyTop', 'flyBottom', 'zoom']
