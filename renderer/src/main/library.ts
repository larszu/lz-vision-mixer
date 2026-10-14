// Graphics library: finds OGraf manifests (*.ograf.json) in the graphics folders and turns them
// into GraphicInfo for the engine. No Electron here, so it can be tested in plain Node.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CustomActionInfo, GraphicInfo } from './types'

export const OGRAF_SCHEMA_URL = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json'

export interface LibraryEntry {
  info: GraphicInfo
  manifestPath: string
  /** Folder of the manifest; `main` and all resources resolve against it. */
  dir: string
  /** `main` from the manifest, relative to `dir`. */
  main: string
  /** Changes when the manifest or the main module changes (used to bust the module cache). */
  revision: string
}

export interface ScanResult {
  entries: LibraryEntry[]
  warnings: string[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export type ManifestResult = { ok: true; entry: Omit<LibraryEntry, 'revision'>; warnings: string[] } | { ok: false; error: string }

/** Validates one parsed manifest (OGraf v1, real-time use). */
export function parseManifest(json: unknown, manifestPath: string): ManifestResult {
  const warnings: string[] = []
  const where = manifestPath
  if (!isObj(json)) return { ok: false, error: `${where}: not a JSON object` }
  if (json.$schema !== OGRAF_SCHEMA_URL) warnings.push(`${where}: "$schema" is not the OGraf v1 manifest schema`)
  const { id, name, main } = json
  if (typeof id !== 'string' || !id) return { ok: false, error: `${where}: missing "id"` }
  if (id.includes('/')) return { ok: false, error: `${where}: "id" must not contain "/"` }
  if (typeof name !== 'string' || !name) return { ok: false, error: `${where}: missing "name"` }
  if (typeof main !== 'string' || !main) return { ok: false, error: `${where}: missing "main"` }
  if (json.supportsRealTime !== true) return { ok: false, error: `${where}: graphic does not support real-time rendering` }

  const dir = path.dirname(manifestPath)
  const mainPath = path.resolve(dir, main)
  if (!isInside(dir, mainPath)) return { ok: false, error: `${where}: "main" points outside the graphic folder` }

  let stepCount = 1
  if (json.stepCount !== undefined) {
    if (typeof json.stepCount === 'number' && Number.isInteger(json.stepCount) && json.stepCount >= -1) stepCount = json.stepCount
    else warnings.push(`${where}: invalid "stepCount", using 1`)
  }

  const customActions: CustomActionInfo[] = []
  if (Array.isArray(json.customActions)) {
    for (const a of json.customActions) {
      if (!isObj(a) || typeof a.id !== 'string' || typeof a.name !== 'string') {
        warnings.push(`${where}: skipped an invalid custom action`)
        continue
      }
      const action: CustomActionInfo = { id: a.id, name: a.name }
      if (typeof a.description === 'string') action.description = a.description
      if (isObj(a.schema)) action.schema = a.schema
      customActions.push(action)
    }
  }

  return {
    ok: true,
    warnings,
    entry: {
      info: {
        id,
        name,
        description: typeof json.description === 'string' ? json.description : '',
        path: dir,
        schema: isObj(json.schema) ? json.schema : null,
        stepCount,
        customActions,
      },
      manifestPath,
      dir,
      main,
    },
  }
}

export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Top-level `default` values of a data schema, as a starting point for `load({data})`. */
export function schemaDefaults(schema: object | null): Record<string, unknown> {
  const props = isObj(schema) && isObj((schema as Record<string, unknown>).properties) ? ((schema as Record<string, unknown>).properties as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const [key, prop] of Object.entries(props)) {
    if (isObj(prop) && 'default' in prop) out[key] = structuredClone(prop.default)
  }
  return out
}

const MAX_DEPTH = 3
const SKIP_DIRS = new Set(['node_modules'])

async function findManifests(root: string, depth = 0, out: string[] = []): Promise<string[]> {
  let items
  try {
    items = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    if (item.name.startsWith('.')) continue
    const p = path.join(root, item.name)
    if (item.isFile() && item.name.endsWith('.ograf.json')) out.push(p)
    else if (item.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(item.name)) await findManifests(p, depth + 1, out)
  }
  return out
}

async function mtime(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Scans the folders in priority order: a graphic id found in a later folder replaces the same id
 * from an earlier one (so user folders can override bundled graphics). Missing folders are skipped.
 */
export async function scanLibrary(roots: string[]): Promise<ScanResult> {
  const byId = new Map<string, LibraryEntry>()
  const warnings: string[] = []
  for (const root of roots) {
    for (const manifestPath of (await findManifests(root)).sort()) {
      let json: unknown
      try {
        json = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      } catch (e) {
        warnings.push(`${manifestPath}: ${(e as Error).message}`)
        continue
      }
      const r = parseManifest(json, manifestPath)
      if (!r.ok) {
        warnings.push(r.error)
        continue
      }
      warnings.push(...r.warnings)
      const mainPath = path.resolve(r.entry.dir, r.entry.main)
      const mainTime = await mtime(mainPath)
      if (!mainTime) {
        warnings.push(`${manifestPath}: main module ${r.entry.main} not found`)
        continue
      }
      const prev = byId.get(r.entry.info.id)
      if (prev) warnings.push(`${manifestPath}: id "${r.entry.info.id}" replaces ${prev.manifestPath}`)
      const revision = `${Math.round(await mtime(manifestPath))}-${Math.round(mainTime)}`
      byId.set(r.entry.info.id, { ...r.entry, revision })
    }
  }
  const entries = [...byId.values()].sort((a, b) => a.info.name.localeCompare(b.info.name) || a.info.id.localeCompare(b.info.id))
  return { entries, warnings }
}

/** Valid, unique custom element name for a graphic id + revision. */
export function elementName(id: string, revision: string): string {
  const safe = id.toLowerCase().replace(/[^a-z0-9]/g, '-')
  let h = 0
  for (const c of `${id}\u0000${revision}`) h = (Math.imul(h, 31) + c.codePointAt(0)!) >>> 0
  return `ograf-${safe}-${h.toString(36)}`
}
