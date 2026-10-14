#!/usr/bin/env node
// Fake engine for testing the renderer without the Rust engine: speaks the renderer protocol of
// docs/api.md (WebSocket /renderer + one TCP frame port per layer), counts frames and dumps a
// layer's last frame to PNG.
//
//   node scripts/fake-engine.mjs [--format 1920x1080@50] [--port 4195] [--frame-ports 4198,4199]
//                                [--run "cmd; cmd; …"]
//
// Commands (stdin, one per line, or ';'-separated in --run):
//   load <layer> <graphicId> [json]   play <layer> [json params]   stop <layer> [json params]
//   update <layer> <json>             custom <layer> <id> [json]   clear <layer>     rescan
//   dump <layer> <file.png> [none|checker|grey]   alpha <layer>   stats   lib   wait <ms>
//   waitlib   (until a library message arrived)   waitframes <layer> <n>   quit

import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { WebSocketServer } from 'ws'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def
}
const [, w, h, fps] = /^(\d+)x(\d+)@([\d.]+)$/.exec(opt('format', '1920x1080@50')) ?? []
const format = { width: Number(w), height: Number(h), fps: Number(fps) }
const port = Number(opt('port', '4195'))
const framePorts = opt('frame-ports', '4198,4199').split(',').map(Number)
const frameSize = format.width * format.height * 4

let renderer = null
let library = []
const layers = framePorts.map((p, i) => ({ layer: i + 1, port: p, frames: 0, bytes: 0, last: null, state: null, connections: 0 }))

// ---- frame ports ---------------------------------------------------------------------------
for (const L of layers) {
  createServer((sock) => {
    L.connections++
    console.log(`[frames ${L.layer}] renderer connected (connection ${L.connections})`)
    let cur = Buffer.allocUnsafe(frameSize)
    let fill = 0
    sock.on('data', (chunk) => {
      L.bytes += chunk.length
      let off = 0
      while (off < chunk.length) {
        const n = Math.min(frameSize - fill, chunk.length - off)
        chunk.copy(cur, fill, off, off + n)
        fill += n
        off += n
        if (fill === frameSize) {
          L.last = cur
          L.frames++
          cur = Buffer.allocUnsafe(frameSize)
          fill = 0
        }
      }
    })
    sock.on('close', () => console.log(`[frames ${L.layer}] closed${fill ? ` (${fill} bytes of a partial frame)` : ''}`))
    sock.on('error', () => {})
  }).listen(L.port, '127.0.0.1')
}

// ---- WebSocket -----------------------------------------------------------------------------
const wss = new WebSocketServer({ host: '127.0.0.1', port, path: '/renderer' })
wss.on('connection', (ws) => {
  renderer = ws
  console.log('[ws] renderer connected')
  ws.send(JSON.stringify({ type: 'hello', format, layers: layers.length, framePorts }))
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'library') {
      library = msg.graphics
      console.log(`[ws] library: ${library.map((g) => g.id).join(', ')}`)
    } else if (msg.type === 'layer') {
      layers[msg.layer - 1].state = msg
      console.log(`[ws] layer ${msg.layer}: ${msg.graphicId ?? '-'} ${msg.status} step ${msg.step}${msg.error ? ` error: ${msg.error}` : ''}`)
    } else console.log('[ws]', msg)
  })
  ws.on('close', () => {
    if (renderer === ws) renderer = null
    console.log('[ws] renderer disconnected')
  })
})
console.log(`fake engine: ws://127.0.0.1:${port}/renderer, frames on ${framePorts.join(', ')}, ${format.width}×${format.height}@${format.fps}`)

// ---- PNG -----------------------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** BGRA (straight alpha) → PNG, optionally composited over a checkerboard or grey. */
function encodePng(bgra, width, height, bg) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = y * (width * 4 + 1) + 1 + x * 4
      let r = bgra[s + 2], g = bgra[s + 1], b = bgra[s], a = bgra[s + 3]
      if (bg !== 'none') {
        const base = bg === 'grey' ? 128 : ((x >> 4) + (y >> 4)) % 2 ? 160 : 96
        r = Math.round((r * a + base * (255 - a)) / 255)
        g = Math.round((g * a + base * (255 - a)) / 255)
        b = Math.round((b * a + base * (255 - a)) / 255)
        a = 255
      }
      raw[d] = r
      raw[d + 1] = g
      raw[d + 2] = b
      raw[d + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function alphaStats(buf) {
  let opaque = 0, partial = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1
  for (let i = 0, p = 0; i < buf.length; i += 4, p++) {
    const a = buf[i + 3]
    if (!a) continue
    if (a === 255) opaque++
    else partial++
    const x = p % format.width, y = (p / format.width) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const total = format.width * format.height
  return { visible: opaque + partial, opaque, partial, transparent: total - opaque - partial, bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } }
}

// ---- commands ------------------------------------------------------------------------------
const send = (msg) => (renderer ? renderer.send(JSON.stringify(msg)) : console.log('no renderer connected'))
const json = (s, def = {}) => (s ? JSON.parse(s) : def)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function command(line) {
  const m = line.trim().match(/^(\S+)(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(.*))?$/)
  if (!m) return
  const [, cmd, a, b, rest] = m
  const tail = (from) => [from, rest].filter(Boolean).join(' ')
  const layer = Number(a)
  switch (cmd) {
    case 'load': return send({ type: 'load', layer, graphicId: b, data: json(rest) })
    case 'play': return send({ type: 'play', layer, params: json(tail(b)) })
    case 'stop': return send({ type: 'stop', layer, params: json(tail(b)) })
    case 'update': return send({ type: 'update', layer, data: json(tail(b)) })
    case 'custom': return send({ type: 'custom', layer, id: b, payload: json(rest) })
    case 'clear': return send({ type: 'clear', layer })
    case 'rescan': return send({ type: 'rescan' })
    case 'wait': return sleep(Number(a))
    case 'waitlib': while (!library.length) await sleep(50); return
    case 'waitframes': { const L = layers[layer - 1]; const target = L.frames + Number(b); while (L.frames < target) await sleep(10); return }
    case 'lib': return console.log(JSON.stringify(library, null, 2))
    case 'stats':
      for (const L of layers) console.log(`layer ${L.layer}: ${L.frames} frames, ${(L.bytes / 1e6).toFixed(1)} MB, connections ${L.connections}, state ${L.state ? `${L.state.status}/${L.state.step}` : '-'}`)
      return
    case 'alpha': {
      const L = layers[layer - 1]
      return console.log(`layer ${layer} alpha:`, L.last ? JSON.stringify(alphaStats(L.last)) : 'no frame yet')
    }
    case 'dump': {
      const L = layers[layer - 1]
      if (!L.last) return console.log(`layer ${layer}: no frame yet`)
      writeFileSync(b, encodePng(L.last, format.width, format.height, rest || 'none'))
      return console.log(`layer ${layer}: frame ${L.frames} → ${b} (${JSON.stringify(alphaStats(L.last))})`)
    }
    case 'quit': process.exit(0)
    default: console.log(`unknown command: ${cmd}`)
  }
}

const script = opt('run', '')
if (script) {
  ;(async () => {
    while (!renderer) await sleep(50)
    for (const c of script.split(';')) {
      if (!c.trim()) continue
      console.log(`> ${c.trim()}`)
      await command(c)
    }
  })()
}
let lines = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (l) => (lines = lines.then(() => command(l)).catch((e) => console.log(e.message))))
