import { describe, expect, it } from 'vitest'
import { coerce, sameData, defaultsFor, humanize, initialData, newItem, schemaToFields, toHexColor } from '../src/schemaForm'

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name', default: 'Anna' },
    notes: { type: 'string', gddType: 'multi-line' },
    size: { type: 'integer', minimum: 10, maximum: 200, default: 48 },
    opacity: { type: 'number', minimum: 0, maximum: 1, multipleOf: 0.05 },
    logo: { type: 'boolean', title: 'Show logo', default: true },
    align: { type: 'string', enum: ['left', 'right'], enumNames: ['Left', 'Right'], default: 'right' },
    color: { type: 'string', gddType: 'color-rrggbb', default: '#1D324F' },
    lines: { type: 'array', items: { type: 'string' }, default: ['a'], maxItems: 3 },
    people: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' } } } },
    deep: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    secret: { type: 'string', hidden: true, default: 'keep' },
    alsoSecret: { type: 'string', gddOptions: { hidden: true } },
    box: { type: 'object', properties: { x: { type: 'number', default: 1 } } },
  },
}

describe('schema to form', () => {
  const fields = schemaToFields(schema)
  const by = (k: string) => fields.find((f) => f.key === k)!

  it('keeps property order and leaves hidden fields out', () => {
    expect(fields.map((f) => f.key)).toEqual(['name', 'notes', 'size', 'opacity', 'logo', 'align', 'color', 'lines', 'people', 'deep', 'box'])
  })
  it('maps types', () => {
    expect(by('name')).toMatchObject({ kind: 'string', label: 'Name', default: 'Anna' })
    expect(by('notes')).toMatchObject({ kind: 'text', label: 'Notes' })
    expect(by('size')).toMatchObject({ kind: 'number', integer: true, min: 10, max: 200, step: 1, default: 48 })
    expect(by('opacity')).toMatchObject({ kind: 'number', integer: false, step: 0.05, default: 0 })
    expect(by('logo')).toMatchObject({ kind: 'boolean', label: 'Show logo', default: true })
    expect(by('align')).toMatchObject({ kind: 'enum', default: 'right', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] })
    expect(by('color')).toMatchObject({ kind: 'color', default: '#1D324F' })
  })
  it('edits arrays of simple items and flat objects, deeper ones as JSON', () => {
    expect(by('lines')).toMatchObject({ kind: 'array', maxItems: 3, default: ['a'], item: { kind: 'string' } })
    expect(by('people').kind).toBe('array')
    expect(by('people').item!.fields!.map((f) => f.key)).toEqual(['name', 'role'])
    expect(by('deep').kind).toBe('json')
  })
  it('nests objects', () => {
    expect(by('box')).toMatchObject({ kind: 'object', default: { x: 1 } })
  })
  it('builds defaults and new items', () => {
    const d = defaultsFor(fields)
    expect(d.name).toBe('Anna')
    expect(d.lines).toEqual(['a'])
    expect(d).not.toHaveProperty('secret')
    expect(newItem(by('people').item!)).toEqual({ name: '', role: '' })
    expect(newItem(by('lines').item!)).toBe('')
  })
  it('starts from defaults, keeps hidden defaults and overlays the last data', () => {
    const d = initialData(schema, { name: 'Ben', extra: 1 })
    expect(d.name).toBe('Ben')
    expect(d.size).toBe(48)
    expect(d.secret).toBe('keep')
    expect(d.extra).toBe(1)
  })
  it('copies defaults so edits do not change the schema', () => {
    const d = initialData(schema, null)
    ;(d.lines as string[]).push('b')
    expect(by('lines').default).toEqual(['a'])
  })
  it('handles missing or empty schemas', () => {
    expect(schemaToFields(null)).toEqual([])
    expect(schemaToFields({ type: 'object' })).toEqual([])
  })
})

describe('helpers', () => {
  it('humanizes keys', () => {
    expect(humanize('showTranslation')).toBe('Show translation')
    expect(humanize('font_size')).toBe('Font size')
  })
  it('coerces numbers to the field limits', () => {
    const f = schemaToFields(schema).find((x) => x.key === 'size')!
    expect(coerce(f, '12,7')).toBe(13)
    expect(coerce(f, '999')).toBe(200)
    expect(coerce(f, 'abc')).toBe(48)
  })
  it('normalises colours for the colour picker', () => {
    expect(toHexColor('#1D324F')).toBe('#1d324f')
    expect(toHexColor('#abc')).toBe('#aabbcc')
    expect(toHexColor('#11223344')).toBe('#112233')
    expect(toHexColor('red')).toBe('#000000')
  })
})

describe('sameData', () => {
  it('ignores key order but not values', () => {
    expect(sameData({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameData([1, 2], [2, 1])).toBe(false)
  })
})
