import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deKeys } from '../src/i18n'

// Every t('…') literal and every preset label, hint and shortcut needs a German entry.
describe('German translation', () => {
  it('covers every UI string', () => {
    const src = join(__dirname, '../src')
    const keys = new Set(deKeys)
    const missing: string[] = []
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const text = readFileSync(join(src, f), 'utf8')
      for (const m of text.matchAll(/\bt\('([^']+)'\)/g)) if (!keys.has(m[1])) missing.push(`${f}: ${m[1]}`)
      // Data tables whose strings go through t() at render time.
      if (f === 'helpers.ts' || f === 'vfa.ts')
        for (const m of text.matchAll(/\b(?:label|hint|action): '([^']+)'/g)) if (!keys.has(m[1])) missing.push(`${f}: ${m[1]}`)
    }
    expect(missing).toEqual([])
  })
})
