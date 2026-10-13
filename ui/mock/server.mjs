// Mock of the LZ Vision Mixer engine for UI development (docs/api.md).
// Simulates state, commands, transitions, levels and the multiview stream.
// Run: npm run mock   (MOCK_DECKLINK=1 pretends DeckLink hardware exists)
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = 4195
const HOST = '127.0.0.1'
const FRAME = readFileSync(join(here, 'multiview.jpg'))
const DIST = join(here, '..', 'dist')

const slot = (n, name, spec, extra = {}) => ({
  slot: n,
  name,
  spec,
  status: spec ? 'running' : 'empty',
  error: null,
  audio: { volume: 1, muted: false, afv: true },
  ...extra,
})

const state = {
  version: '0.1.0-mock',
  format: { width: 1920, height: 1080, fps: 50, name: '1080p50' },
  slots: [
    slot(1, 'SMPTE bars', 'test:smpte'),
    slot(2, 'Intro clip', 'file:/clips/intro.mp4'),
    slot(3, 'Ball', 'test:ball'),
    slot(4, '', null),
    slot(5, 'Snow', 'test:snow'),
    slot(6, 'Logo', 'image:/stills/logo.png'),
    slot(7, 'Camera 1', 'decklink:0', { status: 'error', error: 'DeckLink not available' }),
    slot(8, '', null),
  ],
  program: 1,
  preview: 2,
  transition: { kind: 'mix', durationMs: 1000, easing: { family: 'cubic', direction: 'inOut' } },
  inTransition: false,
  tbar: 0,
  ftb: false,
  overlays: [
    { index: 1, slot: 6, onAir: false, rect: { x: 0.66, y: 0.05, w: 0.3, h: 0.3 }, transition: 'fade', durationMs: 500 },
    { index: 2, slot: null, onAir: false, rect: { x: 0, y: 0, w: 1, h: 1 }, transition: 'cut', durationMs: 500 },
  ],
  outputs: [{ id: 'out-1', spec: 'ndi:LZ Vision Mixer', status: 'running', error: null }],
  master: { volume: 1, muted: false },
  capabilities: {
    decklink: process.env.MOCK_DECKLINK === '1',
    ndi: true,
    srt: true,
    st2110: false,
    encoders: ['x264enc', 'avenc_aac'],
  },
}
state.slots[6].status = state.capabilities.decklink ? 'running' : 'error'
if (state.capabilities.decklink) state.slots[6].error = null

/* ---------- broadcasting ---------- */

const clients = new Set()
function broadcast(msg) {
  const s = JSON.stringify(msg)
  for (const c of clients) if (c.readyState === 1) c.send(s)
}
const pushState = () => broadcast({ type: 'state', state })

/* ---------- transitions ---------- */

let anim = null

function completeTransition() {
  if (anim) clearInterval(anim)
  anim = null
  const p = state.program
  state.program = state.preview
  state.preview = p
  state.inTransition = false
  state.tbar = 0
}

function runAuto() {
  if (state.inTransition || state.preview == null) return
  if (state.transition.kind === 'cut' || state.transition.durationMs === 0) {
    completeTransition()
    return
  }
  const start = Date.now()
  const startT = state.tbar
  state.inTransition = true
  anim = setInterval(() => {
    const p = startT + (Date.now() - start) / state.transition.durationMs
    if (p >= 1) completeTransition()
    else state.tbar = p
    pushState()
  }, 40)
}

/* ---------- commands ---------- */

class CmdError extends Error {}
const need = (cond, msg) => {
  if (!cond) throw new CmdError(msg)
}
const getSlot = (n) => {
  const s = state.slots.find((x) => x.slot === n)
  need(s, `No such slot: ${n}`)
  return s
}
const getOverlay = (i) => {
  const o = state.overlays.find((x) => x.index === i)
  need(o, `No such overlay: ${i}`)
  return o
}

function nameFromSpec(spec) {
  const m = /^(test|decklink|ndi|file|image):(.*)$/.exec(spec)
  if (!m) return spec.split('?')[0].replace(/^\w+:\/\//, '')
  if (m[1] === 'test') return m[2].toUpperCase()
  if (m[1] === 'decklink') return `DeckLink ${Number(m[2]) + 1}`
  return m[2].split('/').pop() || m[1]
}

function sourceProblem(spec) {
  if (spec.startsWith('decklink:') && !state.capabilities.decklink) return 'DeckLink not available'
  if (spec.startsWith('ndi:') && !state.capabilities.ndi) return 'NDI not available'
  if (spec.startsWith('srt://') && !state.capabilities.srt) return 'SRT not available'
  if (spec.startsWith('st2110:')) return 'ST 2110 is not wired yet'
  if (!/^(test:(smpte|bars|ball|black|snow)|decklink:\d+|ndi:.+|(srt|rtmp|rtsp|https?):\/\/.+|file:\/.+|image:\/.+|st2110:.+)$/.test(spec))
    return `Unknown source spec: ${spec}`
  return null
}

function outputProblem(spec) {
  if (spec.startsWith('decklink') && !state.capabilities.decklink) return 'DeckLink not available'
  if (spec.startsWith('ndi:') && !state.capabilities.ndi) return 'NDI not available'
  if (spec.startsWith('srt://') && !state.capabilities.srt) return 'SRT not available'
  return null
}

let outputSeq = 1

function apply(c) {
  need(c && typeof c.cmd === 'string', 'Missing cmd')
  switch (c.cmd) {
    case 'setInput': {
      const s = getSlot(c.slot)
      need(typeof c.spec === 'string' && c.spec.trim(), 'Missing spec')
      const problem = sourceProblem(c.spec)
      need(!problem || !problem.startsWith('Unknown'), problem)
      s.spec = c.spec
      s.name = c.name || nameFromSpec(c.spec)
      s.status = 'starting'
      s.error = null
      setTimeout(() => {
        if (s.spec !== c.spec) return
        s.status = problem ? 'error' : 'running'
        s.error = problem
        pushState()
      }, 700)
      break
    }
    case 'clearInput': {
      const s = getSlot(c.slot)
      Object.assign(s, { spec: null, name: '', status: 'empty', error: null })
      break
    }
    case 'renameInput':
      getSlot(c.slot).name = String(c.name ?? '')
      break
    case 'preview':
      getSlot(c.slot)
      need(!state.inTransition, 'Transition running')
      state.preview = c.slot
      break
    case 'program':
      getSlot(c.slot)
      if (anim) clearInterval(anim)
      anim = null
      state.inTransition = false
      state.tbar = 0
      state.program = c.slot
      break
    case 'cut':
      need(!state.inTransition, 'Transition running')
      completeTransition()
      break
    case 'auto':
      runAuto()
      break
    case 'setTransition':
      if (c.kind) state.transition.kind = c.kind
      if (typeof c.durationMs === 'number') state.transition.durationMs = Math.max(0, Math.min(10000, c.durationMs))
      if (c.easing) state.transition.easing = c.easing
      break
    case 'tbar': {
      need(typeof c.value === 'number', 'Missing value')
      need(!anim, 'Auto transition running')
      const v = Math.max(0, Math.min(1, c.value))
      if (v >= 1) completeTransition()
      else state.tbar = v
      break
    }
    case 'ftb':
      state.ftb = !state.ftb
      break
    case 'overlay': {
      const o = getOverlay(c.index)
      if ('slot' in c) {
        if (c.slot != null) getSlot(c.slot)
        o.slot = c.slot
        if (c.slot == null) o.onAir = false
      }
      if (c.rect) o.rect = c.rect
      if (c.transition) o.transition = c.transition
      if (typeof c.durationMs === 'number') o.durationMs = c.durationMs
      break
    }
    case 'overlayOn': {
      const o = getOverlay(c.index)
      need(!c.on || o.slot != null, `Overlay ${c.index} has no input`)
      o.onAir = !!c.on
      break
    }
    case 'audio': {
      const s = getSlot(c.slot)
      if (typeof c.volume === 'number') s.audio.volume = Math.max(0, Math.min(2, c.volume))
      if (typeof c.muted === 'boolean') s.audio.muted = c.muted
      if (typeof c.afv === 'boolean') s.audio.afv = c.afv
      break
    }
    case 'master':
      if (typeof c.volume === 'number') state.master.volume = Math.max(0, Math.min(2, c.volume))
      if (typeof c.muted === 'boolean') state.master.muted = c.muted
      break
    case 'addOutput': {
      need(typeof c.spec === 'string' && c.spec.trim(), 'Missing spec')
      need(/^(decklink(-mv)?:\d+|ndi:.+|srt:\/\/.+|rtmp:\/\/.+|record:.+)$/.test(c.spec), `Unknown output spec: ${c.spec}`)
      const o = { id: `out-${++outputSeq}`, spec: c.spec, status: 'starting', error: null }
      state.outputs.push(o)
      const problem = outputProblem(c.spec)
      setTimeout(() => {
        o.status = problem ? 'error' : 'running'
        o.error = problem
        pushState()
      }, 900)
      break
    }
    case 'removeOutput': {
      const i = state.outputs.findIndex((o) => o.id === c.id)
      need(i >= 0, `No such output: ${c.id}`)
      state.outputs.splice(i, 1)
      break
    }
    default:
      throw new CmdError(`Unknown cmd: ${c.cmd}`)
  }
  pushState()
}

/* ---------- levels ---------- */

const gainDb = (g) => (g <= 0 ? -90 : 20 * Math.log10(g))
let phase = 0
setInterval(() => {
  phase += 0.1
  const slots = {}
  let master = -90
  for (const s of state.slots) {
    let db = -90
    if (s.status === 'running' && s.spec && !s.spec.startsWith('image:') && s.spec !== 'test:black') {
      const tone = s.spec === 'test:smpte' || s.spec === 'test:bars'
      db = tone ? -18 : -24 + 10 * Math.sin(phase * (1 + s.slot * 0.3)) + Math.random() * 4
      db += gainDb(s.audio.volume)
      if (s.audio.muted) db = -90
    }
    const l = Math.min(0, db)
    const r = Math.min(0, db === -90 ? -90 : db - Math.random() * 2)
    slots[s.slot] = [l, r]
    const audible = !s.audio.afv || s.slot === state.program
    if (audible) master = Math.max(master, l)
  }
  master = state.master.muted || state.ftb ? -90 : Math.min(0, master + gainDb(state.master.volume))
  broadcast({ type: 'levels', levels: { slots, master: [master, master === -90 ? -90 : master - 1] } })
}, 100)

/* ---------- HTTP ---------- */

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function run(res, cmd) {
  try {
    apply(cmd)
    json(res, 200, { ok: true })
  } catch (e) {
    json(res, 400, { error: e.message })
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`)
  const p = url.pathname
  if (p === '/mjpeg/multiview') {
    const b = 'lzframe'
    res.writeHead(200, { 'content-type': `multipart/x-mixed-replace; boundary=${b}`, 'cache-control': 'no-store' })
    const send = () => {
      res.write(`--${b}\r\ncontent-type: image/jpeg\r\ncontent-length: ${FRAME.length}\r\n\r\n`)
      res.write(FRAME)
      res.write('\r\n')
    }
    send()
    const id = setInterval(send, 200) // 5 fps is plenty for a static frame
    req.on('close', () => clearInterval(id))
    return
  }
  if (p === '/api/state') return json(res, 200, state)
  if (p === '/api/cmd' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      let cmd
      try {
        cmd = JSON.parse(body)
      } catch {
        return json(res, 400, { error: 'Invalid JSON' })
      }
      run(res, cmd)
    })
    return
  }
  let m
  if (p === '/api/cut') return run(res, { cmd: 'cut' })
  if (p === '/api/auto') return run(res, { cmd: 'auto' })
  if (p === '/api/ftb') return run(res, { cmd: 'ftb' })
  if ((m = /^\/api\/(preview|program)\/(\d+)$/.exec(p))) return run(res, { cmd: m[1], slot: Number(m[2]) })
  if ((m = /^\/api\/overlay\/(\d+)\/toggle$/.exec(p))) {
    const o = state.overlays.find((x) => x.index === Number(m[1]))
    return run(res, { cmd: 'overlayOn', index: Number(m[1]), on: !o?.onAir })
  }
  if ((m = /^\/api\/tbar\/([\d.]+)$/.exec(p))) return run(res, { cmd: 'tbar', value: Number(m[1]) })

  // Serve the built UI like the engine does, if it exists.
  const file = normalize(join(DIST, p === '/' ? 'index.html' : p))
  if (file.startsWith(DIST) && existsSync(file)) {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    return res.end(readFileSync(file))
  }
  res.writeHead(404)
  res.end('not found')
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, `http://${HOST}`).pathname !== '/ws') return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws)
    ws.send(JSON.stringify({ type: 'state', state }))
    ws.on('message', (data) => {
      try {
        apply(JSON.parse(String(data)))
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e instanceof CmdError ? e.message : 'Invalid command' }))
      }
    })
    ws.on('close', () => clients.delete(ws))
  })
})

server.listen(PORT, HOST, () => console.log(`LZ Vision Mixer mock on http://${HOST}:${PORT}`))
