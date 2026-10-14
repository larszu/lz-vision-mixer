// The ograf:// scheme serves the renderer's own pages and the files of every graphic:
//   ograf://app/pages/<path>         → dist/pages/<path>
//   ograf://app/g/<graphic id>/<path> → <graphic folder>/<path>
// A real (standard, secure) origin is needed so graphics can import ES modules, fetch files
// relative to import.meta.url and load fonts — file:// would block module scripts.

import { net, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isInside, type LibraryEntry } from './library'

export const SCHEME = 'ograf'
export const HOST_URL = `${SCHEME}://app/pages/host/index.html`
export const STATUS_URL = `${SCHEME}://app/pages/status/index.html`

export function graphicUrl(id: string, file: string): string {
  return `${SCHEME}://app/g/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`
}

/** Must run before app 'ready'. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ])
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

export function handleScheme(pagesDir: string, lookup: (id: string) => LibraryEntry | undefined): void {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    let base: string | undefined
    let rel: string[] = []
    if (parts[0] === 'pages') {
      base = pagesDir
      rel = parts.slice(1)
    } else if (parts[0] === 'g' && parts.length >= 3) {
      base = lookup(parts[1])?.dir
      rel = parts.slice(2)
    }
    if (!base) return new Response('not found', { status: 404 })
    const file = path.resolve(base, ...rel)
    if (!isInside(base, file)) return new Response('forbidden', { status: 403 })
    const type = TYPES[path.extname(file).toLowerCase()]
    try {
      if (type) {
        const body = await fs.readFile(file)
        return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' } })
      }
      // Images, video, audio: let Chromium's file loader handle types and range requests.
      return await net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
