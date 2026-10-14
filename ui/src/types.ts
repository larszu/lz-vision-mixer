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
  audio: { volume: number; muted: boolean; afv: boolean; delayMs: number }
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

export interface AudioDevice {
  id: string
  name: string
  channels: number
}

export interface Mic {
  mic: number
  name: string
  device: string | null
  channel: number
  status: 'empty' | 'starting' | 'running' | 'error'
  error: string | null
  volume: number
  muted: boolean
  inProgram: boolean
  /** Lip-sync delay 0..500 ms. */
  delayMs: number
  strip: Strip
}

/** Mic channel strip: denoise → high-pass → gate → compressor → makeup. */
export interface Strip {
  /** High-pass corner 20..400 Hz, 0 = off. */
  hpfHz: number
  gate: boolean
  gateThresholdDb: number
  gateRangeDb: number
  comp: boolean
  compThresholdDb: number
  compRatio: number
  compAttackMs: number
  compReleaseMs: number
  makeupDb: number
  /** RNNoise; switching it restarts the mic briefly. */
  denoise: boolean
}

export interface Osc {
  /** Receive address ("127.0.0.1:4210"), null = off. */
  listen: string | null
  /** Feedback targets, "host:port". */
  targets: string[]
}

export interface VfaRule {
  /** "slot:N" or "mic:N" */
  source: string
  camera: number
}

export type VfaTransition = 'cut' | 'auto'

export interface VfaSettings {
  thresholdDb: number
  dominanceDb: number
  attackMs: number
  minShotMs: number
  silenceMs: number
  maxShotMs: number
  wideBreakMs: number
}

export interface Vfa extends VfaSettings {
  enabled: boolean
  rules: VfaRule[]
  wideSlot: number | null
  transition: VfaTransition
  /** Current speaker source, "wide", or null. */
  speaking: string | null
}

/** JSON schema as found in an OGraf manifest (GDD flavoured). Loosely typed on purpose. */
export type JsonSchema = Record<string, unknown>

export interface GraphicAction {
  id: string
  name: string
  description?: string
  schema?: JsonSchema
}

export interface GraphicInfo {
  id: string
  name: string
  description: string
  path: string
  schema: JsonSchema | null
  stepCount: number
  customActions: GraphicAction[]
}

export type GraphicsStatus = 'empty' | 'loading' | 'ready' | 'playing' | 'stopped' | 'error'

export interface GraphicsLayer {
  layer: number
  graphicId: string | null
  data: Record<string, unknown>
  status: GraphicsStatus
  step: number
  error: string | null
}

export interface Graphics {
  rendererConnected: boolean
  library: GraphicInfo[]
  layers: GraphicsLayer[]
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
  audioDevices: AudioDevice[]
  /** Audio outputs, for the `audio:<id>` output spec. */
  audioOutputs: AudioDevice[]
  mics: Mic[]
  vfa: Vfa
  graphics: Graphics
  osc: Osc
}

export interface Levels {
  slots: Record<number, [number, number]>
  master: [number, number]
  /** Peak dBFS per mic (mono). */
  mics: Record<number, number>
  /** Pre-fader RMS dBFS per VFA source ("slot:3", "mic:2"). */
  speech: Record<string, number>
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
  | { cmd: 'audio'; slot: number; volume?: number; muted?: boolean; afv?: boolean; delayMs?: number }
  | { cmd: 'master'; volume?: number; muted?: boolean }
  | { cmd: 'addOutput'; spec: string }
  | { cmd: 'removeOutput'; id: string }
  | { cmd: 'setMic'; mic: number; device: string; channel: number; name?: string }
  | { cmd: 'clearMic'; mic: number }
  | { cmd: 'renameMic'; mic: number; name: string }
  | { cmd: 'micAudio'; mic: number; volume?: number; muted?: boolean; inProgram?: boolean; delayMs?: number }
  | { cmd: 'micStrip'; mic: number; strip: Partial<Strip> }
  | { cmd: 'refreshDevices' }
  | ({ cmd: 'setVfa'; enabled?: boolean; rules?: VfaRule[]; wideSlot?: number | null; transition?: VfaTransition } & Partial<VfaSettings>)
  | { cmd: 'gfxLoad'; layer: number; graphicId: string; data?: Record<string, unknown> }
  | { cmd: 'gfxPlay'; layer: number; delta?: number; goto?: number; skipAnimation?: boolean }
  | { cmd: 'gfxStop'; layer: number; skipAnimation?: boolean }
  | { cmd: 'gfxUpdate'; layer: number; data: Record<string, unknown> }
  | { cmd: 'gfxCustom'; layer: number; id: string; payload?: Record<string, unknown> }
  | { cmd: 'gfxClear'; layer: number }
  | { cmd: 'gfxRescan' }
  | { cmd: 'setOscTargets'; targets: string[] }

export type ServerMessage =
  | { type: 'state'; state: State }
  | { type: 'levels'; levels: Levels }
  | { type: 'error'; message: string }

export const TRANSITION_KINDS: TransitionKind[] = ['cut', 'mix', 'dip', 'pushLeft', 'pushRight', 'slideLeft', 'slideRight', 'zoom']
export const OVERLAY_TRANSITIONS: OverlayTransition[] = ['cut', 'fade', 'flyLeft', 'flyRight', 'flyTop', 'flyBottom', 'zoom']
