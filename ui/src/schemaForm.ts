// Turns the JSON schema of an OGraf manifest (with GDD hints) into a flat
// field model the UI can render. Pure, so it is unit-tested.
import type { JsonSchema } from './types'

export type FieldKind = 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'color' | 'array' | 'object' | 'json'

export interface FieldModel {
  key: string
  label: string
  description?: string
  kind: FieldKind
  default: unknown
  /** number */
  min?: number
  max?: number
  step?: number
  integer?: boolean
  /** enum */
  options?: { value: string | number; label: string }[]
  /** array */
  item?: FieldModel
  minItems?: number
  maxItems?: number
  /** object */
  fields?: FieldModel[]
  /** string */
  maxLength?: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function typeOf(s: JsonSchema): string | undefined {
  const t = s.type
  if (Array.isArray(t)) return t.find((x) => x !== 'null') as string | undefined
  return typeof t === 'string' ? t : undefined
}

/** Readable label from a property key: "showTranslation" → "Show translation". */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function isHidden(s: JsonSchema): boolean {
  if (s.hidden === true) return true
  const opts = s.gddOptions
  return isObj(opts) && opts.hidden === true
}

function fieldFor(key: string, s: JsonSchema): FieldModel {
  const label = typeof s.title === 'string' && s.title ? s.title : humanize(key)
  const description = typeof s.description === 'string' ? s.description : undefined
  const gdd = typeof s.gddType === 'string' ? s.gddType : ''
  const type = typeOf(s)
  const base = { key, label, description }

  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const names = Array.isArray(s.enumNames) ? s.enumNames : Array.isArray(s.enumLabels) ? s.enumLabels : null
    const options = s.enum
      .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
      .map((v, i) => ({ value: v, label: names && typeof names[i] === 'string' ? (names[i] as string) : String(v) }))
    return { ...base, kind: 'enum', options, default: s.default ?? options[0]?.value ?? '' }
  }

  switch (type) {
    case 'string':
      if (gdd.startsWith('color-rrggbb')) return { ...base, kind: 'color', default: typeof s.default === 'string' ? s.default : '#ffffff' }
      return {
        ...base,
        kind: gdd === 'multi-line' ? 'text' : 'string',
        default: typeof s.default === 'string' ? s.default : '',
        maxLength: typeof s.maxLength === 'number' ? s.maxLength : undefined,
      }
    case 'number':
    case 'integer': {
      const integer = type === 'integer'
      const min = typeof s.minimum === 'number' ? s.minimum : undefined
      const max = typeof s.maximum === 'number' ? s.maximum : undefined
      const step = typeof s.multipleOf === 'number' ? s.multipleOf : integer ? 1 : undefined
      return { ...base, kind: 'number', integer, min, max, step, default: typeof s.default === 'number' ? s.default : (min ?? 0) }
    }
    case 'boolean':
      return { ...base, kind: 'boolean', default: typeof s.default === 'boolean' ? s.default : false }
    case 'array': {
      const items = isObj(s.items) ? (s.items as JsonSchema) : null
      const item = items ? fieldFor('', items) : null
      // Arrays of simple items or flat objects get an editor; anything deeper is edited as JSON.
      const simple = item && item.kind !== 'array' && item.kind !== 'json' && (item.kind !== 'object' || item.fields!.every((f) => isSimple(f.kind)))
      if (!simple) return { ...base, kind: 'json', default: Array.isArray(s.default) ? s.default : [] }
      return {
        ...base,
        kind: 'array',
        item: item!,
        minItems: typeof s.minItems === 'number' ? s.minItems : undefined,
        maxItems: typeof s.maxItems === 'number' ? s.maxItems : undefined,
        default: Array.isArray(s.default) ? s.default : [],
      }
    }
    case 'object': {
      const fields = schemaToFields(s)
      return { ...base, kind: 'object', fields, default: isObj(s.default) ? s.default : defaultsFor(fields) }
    }
    default:
      return { ...base, kind: 'json', default: s.default ?? null }
  }
}

function isSimple(k: FieldKind) {
  return k === 'string' || k === 'text' || k === 'number' || k === 'boolean' || k === 'enum' || k === 'color'
}

/** Visible fields of an object schema, in property order. Hidden fields are left out. */
export function schemaToFields(schema: JsonSchema | null | undefined): FieldModel[] {
  if (!schema || !isObj(schema.properties)) return []
  const out: FieldModel[] = []
  for (const [key, raw] of Object.entries(schema.properties)) {
    if (!isObj(raw) || isHidden(raw)) continue
    out.push(fieldFor(key, raw))
  }
  return out
}

export function defaultsFor(fields: FieldModel[]): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const f of fields) o[f.key] = structuredClone(f.default)
  return o
}

/** Default item for an array editor. */
export function newItem(item: FieldModel): unknown {
  if (item.kind === 'object') return defaultsFor(item.fields ?? [])
  if (item.default !== undefined && item.default !== null && item.default !== '') return structuredClone(item.default)
  switch (item.kind) {
    case 'number':
      return item.min ?? 0
    case 'boolean':
      return false
    case 'enum':
      return item.options?.[0]?.value ?? ''
    case 'color':
      return '#ffffff'
    default:
      return ''
  }
}

/**
 * Data to edit for a layer: the schema defaults, overlaid with what the layer
 * last got (hidden fields included, so they survive an update untouched).
 */
export function initialData(schema: JsonSchema | null | undefined, last: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const fields = schemaToFields(schema)
  const hiddenDefaults: Record<string, unknown> = {}
  if (schema && isObj(schema.properties))
    for (const [k, raw] of Object.entries(schema.properties)) if (isObj(raw) && isHidden(raw) && 'default' in raw) hiddenDefaults[k] = structuredClone(raw.default)
  return { ...hiddenDefaults, ...defaultsFor(fields), ...(last ?? {}) }
}

/** Coerce a typed value back to the field's type (numbers from inputs, clamped). */
export function coerce(f: FieldModel, raw: string): unknown {
  if (f.kind !== 'number') return raw
  let v = Number(raw.replace(',', '.'))
  if (!Number.isFinite(v)) v = typeof f.default === 'number' ? f.default : 0
  if (f.integer) v = Math.round(v)
  if (f.min !== undefined) v = Math.max(f.min, v)
  if (f.max !== undefined) v = Math.min(f.max, v)
  return v
}

/** HTML colour inputs need #rrggbb; GDD allows any case and sometimes #rgb. */
export function toHexColor(v: unknown): string {
  if (typeof v !== 'string') return '#000000'
  const s = v.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7).toLowerCase()
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase()
  return '#000000'
}

/** Deep equality that ignores key order (the engine may echo data with keys reordered). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameData(x, b[i]))
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a)
    if (ka.length !== Object.keys(b).length) return false
    return ka.every((k) => k in b && sameData(a[k], b[k]))
  }
  return false
}
