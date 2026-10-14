// Engine ↔ renderer protocol (docs/api.md, "Renderer protocol"). Pure: parsing and building only.

import type { Format, GraphicInfo, LayerState, PlayParams, StopParams } from './types'

export interface HelloMessage {
  type: 'hello'
  format: Format
  layers: number
  framePorts: number[]
}

export type EngineMessage =
  | HelloMessage
  | { type: 'load'; layer: number; graphicId: string; data: Record<string, unknown> }
  | { type: 'play'; layer: number; params: PlayParams }
  | { type: 'stop'; layer: number; params: StopParams }
  | { type: 'update'; layer: number; data: Record<string, unknown> }
  | { type: 'custom'; layer: number; id: string; payload: unknown }
  | { type: 'clear'; layer: number }
  | { type: 'rescan' }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isPosNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

function optInt(v: unknown): number | undefined {
  return isInt(v) ? v : undefined
}
function optBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/** Drops undefined keys so the graphic sees exactly the fields the engine set. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

export type ParseResult = { ok: true; msg: EngineMessage } | { ok: false; error: string }

/** Parses one text frame from the engine. Layer numbers are 1-based and checked against `layerCount` when given. */
export function parseEngineMessage(text: string, layerCount?: number): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not JSON' }
  }
  if (!isObj(raw) || typeof raw.type !== 'string') return { ok: false, error: 'missing "type"' }
  const fail = (error: string): ParseResult => ({ ok: false, error: `${raw && (raw as { type: string }).type}: ${error}` })

  if (raw.type === 'hello') {
    const f = raw.format
    if (!isObj(f) || !isInt(f.width) || !isInt(f.height) || f.width <= 0 || f.height <= 0 || !isPosNum(f.fps)) {
      return fail('bad format')
    }
    const ports = raw.framePorts
    if (!Array.isArray(ports) || !ports.every((p) => isInt(p) && p > 0 && p < 65536)) return fail('bad framePorts')
    const layers = isInt(raw.layers) && raw.layers > 0 ? raw.layers : ports.length
    if (ports.length < layers) return fail('fewer framePorts than layers')
    return {
      ok: true,
      msg: { type: 'hello', format: { width: f.width, height: f.height, fps: f.fps }, layers, framePorts: ports as number[] },
    }
  }
  if (raw.type === 'rescan') return { ok: true, msg: { type: 'rescan' } }

  const layer = raw.layer
  if (!isInt(layer) || layer < 1 || (layerCount !== undefined && layer > layerCount)) return fail('bad layer')

  switch (raw.type) {
    case 'load':
      if (typeof raw.graphicId !== 'string' || !raw.graphicId) return fail('missing graphicId')
      return { ok: true, msg: { type: 'load', layer, graphicId: raw.graphicId, data: isObj(raw.data) ? raw.data : {} } }
    case 'play': {
      const p = isObj(raw.params) ? raw.params : {}
      return {
        ok: true,
        msg: { type: 'play', layer, params: compact({ delta: optInt(p.delta), goto: optInt(p.goto), skipAnimation: optBool(p.skipAnimation) }) },
      }
    }
    case 'stop': {
      const p = isObj(raw.params) ? raw.params : {}
      return { ok: true, msg: { type: 'stop', layer, params: compact({ skipAnimation: optBool(p.skipAnimation) }) } }
    }
    case 'update':
      return { ok: true, msg: { type: 'update', layer, data: isObj(raw.data) ? raw.data : {} } }
    case 'custom':
      if (typeof raw.id !== 'string' || !raw.id) return fail('missing id')
      return { ok: true, msg: { type: 'custom', layer, id: raw.id, payload: raw.payload ?? {} } }
    case 'clear':
      return { ok: true, msg: { type: 'clear', layer } }
    default:
      return { ok: false, error: `unknown type ${JSON.stringify(raw.type)}` }
  }
}

export function libraryMessage(graphics: GraphicInfo[]): string {
  return JSON.stringify({ type: 'library', graphics })
}

export function layerMessage(s: LayerState): string {
  return JSON.stringify({ type: 'layer', layer: s.layer, graphicId: s.graphicId, status: s.status, step: s.step, error: s.error })
}

/** Bytes of one raw BGRA frame. */
export function frameBytes(f: { width: number; height: number }): number {
  return f.width * f.height * 4
}

/** Chromium offscreen frame rate for an engine rate: whole frames, 1..60 (59.94 → 60, 29.97 → 30). */
export function paintRate(fps: number): number {
  return Math.min(60, Math.max(1, Math.ceil(fps - 0.01)))
}
