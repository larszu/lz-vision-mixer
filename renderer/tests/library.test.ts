import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { elementName, OGRAF_SCHEMA_URL, parseManifest, scanLibrary, schemaDefaults } from '../src/main/library'

const base = { $schema: OGRAF_SCHEMA_URL, id: 'x', name: 'X', main: 'graphic.mjs', supportsRealTime: true, supportsNonRealTime: false }

function graphic(root: string, folder: string, manifest: object, file = 'g.ograf.json', main = 'graphic.mjs'): string {
  const dir = path.join(root, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, file), JSON.stringify(manifest))
  writeFileSync(path.join(dir, main), 'export default class extends HTMLElement {}')
  return dir
}

describe('parseManifest', () => {
  it('maps a manifest to GraphicInfo', () => {
    const r = parseManifest(
      {
        ...base,
        description: 'd',
        stepCount: -1,
        schema: { type: 'object', properties: {} },
        customActions: [{ id: 'blank', name: 'Blank', description: 'b', schema: { type: 'object' } }, { id: 'n', name: 'N', schema: null }],
      },
      '/g/x/x.ograf.json',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entry.info).toEqual({
      id: 'x',
      name: 'X',
      description: 'd',
      path: '/g/x',
      schema: { type: 'object', properties: {} },
      stepCount: -1,
      customActions: [{ id: 'blank', name: 'Blank', description: 'b', schema: { type: 'object' } }, { id: 'n', name: 'N' }],
    })
    expect(r.warnings).toEqual([])
  })
  it('defaults stepCount to 1, description to empty, schema to null', () => {
    const r = parseManifest(base, '/g/x/x.ograf.json')
    expect(r.ok && r.entry.info).toMatchObject({ stepCount: 1, description: '', schema: null, customActions: [] })
  })
  it('rejects missing required fields, ids with "/", non-real-time graphics and mains outside the folder', () => {
    expect(parseManifest({ ...base, id: undefined }, '/m').ok).toBe(false)
    expect(parseManifest({ ...base, id: 'a/b' }, '/m').ok).toBe(false)
    expect(parseManifest({ ...base, name: '' }, '/m').ok).toBe(false)
    expect(parseManifest({ ...base, main: undefined }, '/m').ok).toBe(false)
    expect(parseManifest({ ...base, supportsRealTime: false }, '/m').ok).toBe(false)
    expect(parseManifest({ ...base, main: '../evil.mjs' }, '/g/x/x.ograf.json').ok).toBe(false)
    expect(parseManifest([], '/m').ok).toBe(false)
  })
  it('warns about a foreign $schema but accepts the graphic', () => {
    const r = parseManifest({ ...base, $schema: 'https://example.com' }, '/g/x/x.ograf.json')
    expect(r.ok).toBe(true)
    expect(r.ok && r.warnings.length).toBe(1)
  })
})

describe('schemaDefaults', () => {
  it('collects top-level defaults', () => {
    expect(schemaDefaults({ type: 'object', properties: { a: { type: 'string', default: 'x' }, b: { type: 'number' }, c: { default: [1] } } })).toEqual({ a: 'x', c: [1] })
    expect(schemaDefaults(null)).toEqual({})
  })
})

describe('scanLibrary', () => {
  it('finds graphics in subfolders, sorts by name and lets later folders override ids', async () => {
    const a = mkdtempSync(path.join(tmpdir(), 'lib-a-'))
    const b = mkdtempSync(path.join(tmpdir(), 'lib-b-'))
    graphic(a, 'one', { ...base, id: 'one', name: 'Zulu' })
    graphic(a, 'nested/two', { ...base, id: 'two', name: 'Alpha' })
    graphic(a, 'broken', { ...base, id: 'broken', supportsRealTime: false })
    mkdirSync(path.join(a, 'node_modules/pkg'), { recursive: true })
    writeFileSync(path.join(a, 'node_modules/pkg/x.ograf.json'), JSON.stringify({ ...base, id: 'hidden' }))
    const override = graphic(b, 'one-new', { ...base, id: 'one', name: 'Zulu 2' })
    // Manifest whose main module is missing.
    mkdirSync(path.join(b, 'nomain'))
    writeFileSync(path.join(b, 'nomain/n.ograf.json'), JSON.stringify({ ...base, id: 'nomain' }))
    writeFileSync(path.join(b, 'bad.ograf.json'), '{ nope')

    const r = await scanLibrary([a, b, path.join(a, 'does-not-exist')])
    expect(r.entries.map((e) => e.info.id)).toEqual(['two', 'one'])
    expect(r.entries[1].info.path).toBe(override)
    expect(r.entries[1].revision).toMatch(/^\d+-\d+$/)
    expect(r.warnings.some((w) => w.includes('real-time'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('replaces'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('not found'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('bad.ograf.json'))).toBe(true)
  })
  it('treats several manifests in one folder as separate graphics (OGraf v1)', async () => {
    const a = mkdtempSync(path.join(tmpdir(), 'lib-c-'))
    graphic(a, 'pack', { ...base, id: 'p1', name: 'P1' }, 'p1.ograf.json')
    graphic(a, 'pack', { ...base, id: 'p2', name: 'P2' }, 'p2.ograf.json')
    const r = await scanLibrary([a])
    expect(r.entries.map((e) => e.info.id)).toEqual(['p1', 'p2'])
  })
  it('reads the bundled graphics, including the lz-presenter lyrics graphic', async () => {
    const r = await scanLibrary([path.join(__dirname, '..', 'graphics')])
    expect(r.warnings).toEqual([])
    const ids = r.entries.map((e) => e.info.id).sort()
    expect(ids).toEqual(['lz-bug', 'lz-lower-third', 'lz-lyrics', 'lz-title'])
    const lyrics = r.entries.find((e) => e.info.id === 'lz-lyrics')!
    expect(lyrics.info.stepCount).toBe(-1)
    expect(lyrics.info.customActions.map((c) => c.id)).toEqual(['blank'])
    const lt = r.entries.find((e) => e.info.id === 'lz-lower-third')!
    expect(Object.keys((lt.info.schema as { properties: object }).properties)).toEqual(['name', 'title', 'extra', 'position', 'accentDot', 'style'])
  })
})

describe('elementName', () => {
  it('is a valid custom element name and changes with the revision', () => {
    const n = elementName('LZ Lower/Third', '1-2')
    expect(n).toMatch(/^ograf-[a-z0-9-]+$/)
    expect(elementName('lz', '1-2')).not.toBe(elementName('lz', '1-3'))
  })
})
