// Copies the non-TypeScript files of the pages (HTML, CSS) next to the compiled scripts.
import { cpSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src/pages')
const out = join(root, 'dist/pages')

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (extname(p) !== '.ts') {
      const target = join(out, p.slice(src.length))
      mkdirSync(dirname(target), { recursive: true })
      cpSync(p, target)
    }
  }
}
walk(src)
