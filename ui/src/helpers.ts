// Pure helpers: no DOM, no React, so they can be unit-tested in Node.
import { STRIP_NEUTRAL } from './strip'
import type { Area, Capabilities, Command, GraphicInfo, GraphicsLayer, Levels, Mic, MultiviewLayout, Rect, Slot, State } from './types'
import { VFA_DEFAULTS } from './vfa'

/* ---------- Multiview layout (docs/api.md, state.multiview) ---------- */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const MV_W = 1280
export const MV_H = 720

/**
 * Tile rectangles for `count` inputs, exactly as the engine lays them out:
 * four columns up to eight inputs, then more columns until all rows fit the
 * lower half. Only used when an older engine sends no `multiview`.
 */
export function mvLayout(count: number, width = MV_W, height = MV_H): Area[] {
  let cols = 4
  for (;;) {
    const w = Math.floor(width / cols)
    const h = Math.floor((w * 9) / 16)
    const rows = Math.max(1, Math.ceil(count / cols))
    if (rows * h <= Math.floor(height / 2) || cols >= Math.max(count, 4))
      return Array.from({ length: count }, (_, i) => ({ x: (i % cols) * w, y: Math.floor(height / 2) + Math.floor(i / cols) * h, w, h }))
    cols++
  }
}

export function fallbackMultiview(slots: number[]): MultiviewLayout {
  const half = { w: MV_W / 2, h: MV_H / 2 }
  return {
    width: MV_W,
    height: MV_H,
    preview: { x: 0, y: 0, ...half },
    program: { x: MV_W / 2, y: 0, ...half },
    tiles: mvLayout(slots.length).map((a, i) => ({ ...a, slot: slots[i] })),
  }
}

/** A pixel area of the multiview as fractions 0..1, for CSS percentages. */
export function areaBox(a: Area, mv: { width: number; height: number }): Box {
  return { x: a.x / mv.width, y: a.y / mv.height, w: a.w / mv.width, h: a.h / mv.height }
}

/* ---------- Audio ---------- */

export const FADER_MIN_DB = -60
/** Top of the fader is the API maximum, volume 2 (+6.02 dB). */
export const FADER_MAX_DB = 20 * Math.log10(2)

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain)
}

export function dbToGain(db: number): number {
  return db === -Infinity ? 0 : 10 ** (db / 20)
}

/** Fader travel is linear in dB so the useful range is not crammed at the bottom. */
export function gainToFader(gain: number): number {
  const db = gainToDb(gain)
  if (db <= FADER_MIN_DB) return 0
  return Math.min(1, (db - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB))
}

export function faderToGain(pos: number): number {
  if (pos <= 0) return 0
  const db = FADER_MIN_DB + Math.min(1, pos) * (FADER_MAX_DB - FADER_MIN_DB)
  return Math.min(2, dbToGain(db))
}

export function formatDb(gain: number): string {
  const db = gainToDb(gain)
  if (db === -Infinity || db < FADER_MIN_DB) return '-inf'
  return `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`
}

export const METER_FLOOR_DB = -60

/** Meter fill 0..1 for a dBFS peak (-90 = silence). */
export function meterFill(dbfs: number): number {
  if (!Number.isFinite(dbfs) || dbfs <= METER_FLOOR_DB) return 0
  return Math.min(1, (dbfs - METER_FLOOR_DB) / -METER_FLOOR_DB)
}

export function meterZone(dbfs: number): 'normal' | 'high' | 'clip' {
  if (dbfs >= -3) return 'clip'
  if (dbfs >= -12) return 'high'
  return 'normal'
}

/* ---------- Connection ---------- */

/** Reconnect delay: 0.5 s doubling up to 8 s, so a restarting engine is picked up quickly. */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** Math.max(0, attempt))
}

/** WebSocket URL relative to the page, so the UI works behind any path prefix. */
export function wsUrl(pageHref: string): string {
  const u = new URL('ws', pageHref)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

/* ---------- Keyboard ---------- */

export type KeyAction =
  /** `position` is 1-based in the input list, not the input number. */
  | { kind: 'preview'; position: number }
  | { kind: 'program'; position: number }
  | { kind: 'cut' }
  | { kind: 'auto' }
  | { kind: 'ftb' }
  | { kind: 'vfa' }
  | { kind: 'gfxPlay'; layer: number }
  | { kind: 'gfxStop'; layer: number }
  | { kind: 'help' }

export interface KeyLike {
  code: string
  /** Produced character; only used for "?", which sits on different keys per layout. */
  key?: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** Uses physical key codes, so Shift+1 works on German and English layouts alike. */
export function keyToAction(e: KeyLike): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (m) return { kind: e.shiftKey ? 'program' : 'preview', position: Number(m[1]) }
  if (e.key === '?') return { kind: 'help' }
  if (e.shiftKey) return null
  if (e.code === 'Space') return { kind: 'cut' }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return { kind: 'auto' }
  if (e.code === 'KeyF') return { kind: 'ftb' }
  if (e.code === 'KeyV') return { kind: 'vfa' }
  if (e.code === 'KeyG') return { kind: 'gfxPlay', layer: 1 }
  if (e.code === 'KeyH') return { kind: 'gfxStop', layer: 1 }
  return null
}

/** Input number for digit key 1..9: the first nine inputs in list order, gaps or not. */
export function slotForKey(slots: Pick<Slot, 'slot'>[], position: number): number | null {
  return slots[position - 1]?.slot ?? null
}

/** Digit key of an input, if it is among the first nine. */
export function keyForSlot(slots: Pick<Slot, 'slot'>[], slot: number): number | null {
  const i = slots.findIndex((s) => s.slot === slot)
  return i >= 0 && i < 9 ? i + 1 : null
}

/** Keyboard shortcuts for the help dialog: keys shown as written, action as an English UI string. */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '1 … 9', action: 'First nine inputs to preview' },
  { keys: 'Shift + 1 … 9', action: 'First nine inputs straight to programme' },
  { keys: 'Space', action: 'Cut' },
  { keys: 'Enter', action: 'Auto transition' },
  { keys: 'F', action: 'Fade to black' },
  { keys: 'V', action: 'Video follows audio on/off' },
  { keys: 'G', action: 'Graphics layer 1: in, then next step' },
  { keys: 'H', action: 'Graphics layer 1: out' },
  { keys: '?', action: 'Show shortcuts' },
]

/* ---------- Graphics ---------- */

/**
 * What "play" means for a layer right now: the first play takes the graphic
 * in; while it plays, a multi-step graphic advances one step and a
 * single-step one does nothing.
 */
export function gfxPlayCommand(layer: GraphicsLayer | undefined, info: GraphicInfo | undefined): Command | null {
  if (!layer || !layer.graphicId) return null
  if (layer.status === 'loading' || layer.status === 'error' || layer.status === 'empty') return null
  if (layer.status !== 'playing') return { cmd: 'gfxPlay', layer: layer.layer }
  if (info && info.stepCount === 1) return null
  return { cmd: 'gfxPlay', layer: layer.layer, delta: 1 }
}

export function gfxHasNext(layer: GraphicsLayer, info: GraphicInfo | undefined): boolean {
  if (layer.status !== 'playing' || !info) return false
  if (info.stepCount === -1) return true
  return info.stepCount > 1 && layer.step < info.stepCount - 1
}

/* ---------- Older engines ---------- */

/** Fills the parts of State an older engine does not send yet, so the UI never crashes on them. */
export function normalizeState(raw: State): State {
  const s = raw as Partial<State> & State
  const mics = s.mics ?? []
  const slots = s.slots ?? []
  return {
    ...s,
    slots: slots.map((x) => ({ ...x, audio: { ...x.audio, delayMs: x.audio?.delayMs ?? 0 } })),
    audioDevices: s.audioDevices ?? [],
    videoDevices: s.videoDevices ?? [],
    multiview: s.multiview ?? fallbackMultiview(slots.map((x) => x.slot)),
    audioOutputs: s.audioOutputs ?? [],
    mics: mics.map((m) => ({ ...m, delayMs: (m as Partial<Mic>).delayMs ?? 0, strip: { ...STRIP_NEUTRAL, ...(m as Partial<Mic>).strip } })),
    vfa: s.vfa ?? { ...VFA_DEFAULTS, enabled: false, rules: [], wideSlot: null, transition: 'cut', speaking: null },
    graphics: s.graphics ?? {
      rendererConnected: false,
      library: [],
      layers: [1, 2].map((layer) => ({ layer, graphicId: null, data: {}, status: 'empty' as const, step: 0, error: null })),
    },
    osc: s.osc ?? { listen: null, targets: [] },
  }
}

export function normalizeLevels(raw: Levels): Levels {
  return { ...raw, mics: raw.mics ?? {}, speech: raw.speech ?? {} }
}

/* ---------- Presets ---------- */

export type Need = 'decklink' | 'ndi' | 'srt' | 'st2110' | 'encoder' | 'screen' | 'whep'

export interface SpecPreset {
  label: string
  spec: string
  need?: Need
  /** The spec needs completing (a path, a name, a key), so it only prefills the field. */
  partial?: boolean
}

export const OUTPUT_PRESETS: SpecPreset[] = [
  { label: 'DeckLink 1 programme', spec: 'decklink:0', need: 'decklink' },
  { label: 'DeckLink 2 multiview', spec: 'decklink-mv:1', need: 'decklink' },
  { label: 'NDI programme', spec: 'ndi:LZ Vision Mixer', need: 'ndi' },
  { label: 'SRT listener', spec: 'srt://0.0.0.0:9100?mode=listener', need: 'srt' },
  { label: 'RTMP stream', spec: 'rtmp://a.rtmp.youtube.com/live2/', need: 'encoder', partial: true },
  { label: 'Recording', spec: 'record:/tmp/lz-vision-mixer.mp4', need: 'encoder' },
]

/** Output spec for an audio device (docs/api.md, Output specs). */
export const audioOutputSpec = (deviceId: string) => `audio:${deviceId}`

export function needMet(need: Need | undefined, caps: Capabilities | undefined): boolean {
  if (!need || !caps) return true
  if (need === 'encoder') return caps.encoders.length > 0
  // Older engines do not report screen/whep; assume available there.
  return caps[need] ?? true
}

/** Which capability a typed spec depends on, so free text gets the same warning as presets. */
export function specNeed(spec: string): Need | undefined {
  const s = spec.trim().toLowerCase()
  if (s.startsWith('decklink')) return 'decklink'
  if (s.startsWith('ndi:')) return 'ndi'
  if (s.startsWith('srt://')) return 'srt'
  if (s.startsWith('st2110:')) return 'st2110'
  if (s.startsWith('screen:')) return 'screen'
  if (s.startsWith('whep:')) return 'whep'
  return undefined
}

export const RECT_PRESETS: { label: string; rect: Rect }[] = [
  { label: 'Full', rect: { x: 0, y: 0, w: 1, h: 1 } },
  { label: 'PiP top right', rect: { x: 0.66, y: 0.05, w: 0.3, h: 0.3 } },
  { label: 'PiP bottom left', rect: { x: 0.04, y: 0.65, w: 0.3, h: 0.3 } },
  { label: 'Lower third', rect: { x: 0.05, y: 0.7, w: 0.9, h: 0.22 } },
]

export function sameRect(a: Rect, b: Rect): boolean {
  const eq = (p: number, q: number) => Math.abs(p - q) < 0.001
  return eq(a.x, b.x) && eq(a.y, b.y) && eq(a.w, b.w) && eq(a.h, b.h)
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/* ---------- Tally ---------- */

export type Tally = 'program' | 'preview' | null

interface TallyState {
  program: number | null
  preview: number | null
  inTransition: boolean
  tbar: number
  ftb: boolean
  overlays: { slot: number | null; onAir: boolean }[]
}

/**
 * A slot is on air when it is programme, when it is preview while a
 * transition (auto or T-bar) is mixing it in, or when an on-air overlay
 * shows it. That is what a camera operator needs to know.
 */
export function tallyOf(slot: number, s: TallyState): Tally {
  const mixing = s.inTransition || s.tbar > 0
  if (s.program === slot) return 'program'
  if (mixing && s.preview === slot) return 'program'
  if (s.overlays.some((o) => o.onAir && o.slot === slot)) return 'program'
  if (s.preview === slot) return 'preview'
  return null
}
