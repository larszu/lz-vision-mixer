// Mock of the LZ Vision Mixer engine for UI development (docs/api.md).
// Simulates state, commands, transitions, levels and the multiview stream.
// Also microphones, video follows audio (with a fake conversation) and OGraf graphics.
// Run: npm run mock   (PORT=4295 to avoid a running engine, MOCK_DECKLINK=1 pretends
// DeckLink hardware exists, MOCK_NO_RENDERER=1 starts without a graphics renderer)
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 4195
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
    slot(1, 'Wide', 'test:smpte'),
    slot(2, 'Host', 'test:bars'),
    slot(3, 'Guest 1', 'test:ball'),
    slot(4, 'Guest 2', 'test:snow'),
    slot(5, 'Intro clip', 'file:/clips/intro.mp4'),
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
  audioDevices: [],
  mics: [],
  vfa: {
    enabled: false,
    rules: [
      { source: 'mic:1', camera: 2 },
      { source: 'mic:2', camera: 3 },
      { source: 'mic:3', camera: 4 },
    ],
    wideSlot: 1,
    thresholdDb: -42,
    dominanceDb: 6,
    attackMs: 400,
    minShotMs: 2500,
    silenceMs: 2500,
    maxShotMs: 0,
    wideBreakMs: 3000,
    transition: 'cut',
    speaking: null,
  },
  graphics: { rendererConnected: process.env.MOCK_NO_RENDERER !== '1', library: [], layers: [] },
}
state.slots[6].status = state.capabilities.decklink ? 'running' : 'error'
if (state.capabilities.decklink) state.slots[6].error = null

/* ---------- audio devices and mics ---------- */

const DEVICES = [
  { id: 'coreaudio:builtin', name: 'MacBook Pro Microphone', channels: 1 },
  { id: 'coreaudio:usb-codec', name: 'USB Audio CODEC', channels: 2 },
  { id: 'coreaudio:scarlett-18i8', name: 'Scarlett 18i8 USB', channels: 8 },
]
// "Refresh devices" plugs a recorder in or out, so the refresh is visible.
const EXTRA_DEVICE = { id: 'coreaudio:podtrak-p4', name: 'PodTrak P4', channels: 4 }
state.audioDevices = [...DEVICES]

const mic = (n, name = '', device = null, channel = 0, extra = {}) => ({
  mic: n,
  name,
  device,
  channel,
  status: device ? 'running' : 'empty',
  error: null,
  volume: 1,
  muted: false,
  inProgram: true,
  ...extra,
})
state.mics = [
  mic(1, 'Host', 'coreaudio:scarlett-18i8', 0),
  mic(2, 'Guest 1', 'coreaudio:scarlett-18i8', 1),
  mic(3, 'Guest 2', 'coreaudio:scarlett-18i8', 2),
  mic(4, 'Room', 'coreaudio:usb-codec', 0, { inProgram: false }),
  mic(5, 'Phone', 'coreaudio:podtrak-p4', 0, { status: 'error', error: 'Device not found: coreaudio:podtrak-p4' }),
  mic(6),
  mic(7),
  mic(8),
]

/* ---------- graphics library (what the renderer bundles) ---------- */

const LYRICS = JSON.parse(readFileSync(join(here, 'lyrics.ograf.json'), 'utf8'))
const graphicInfo = (m, path) => ({
  id: m.id,
  name: m.name,
  description: m.description ?? '',
  path,
  schema: m.schema ?? null,
  stepCount: m.stepCount ?? 1,
  customActions: m.customActions ?? [],
})
const LIBRARY = [
  graphicInfo(
    {
      id: 'lz-lower-third',
      name: 'LZ Lower third',
      description: 'Name and role at the bottom left, with the accent line.',
      stepCount: 1,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name', default: 'Lars Zumpe' },
          role: { type: 'string', title: 'Role', default: 'Medienproduktion' },
          align: { type: 'string', title: 'Position', enum: ['left', 'center', 'right'], default: 'left' },
          accentColor: { type: 'string', title: 'Accent line', gddType: 'color-rrggbb', default: '#d6402e' },
          textColor: { type: 'string', title: 'Text colour', gddType: 'color-rrggbb', default: '#f6f5f0' },
          backdrop: { type: 'boolean', title: 'Backdrop', default: true },
          holdSeconds: { type: 'number', title: 'Auto out after', description: 'Seconds, 0 = stays until Out', minimum: 0, maximum: 60, default: 0 },
          brand: { type: 'string', default: 'lzm', hidden: true },
        },
        required: ['name'],
      },
    },
    'renderer/graphics/lz-lower-third',
  ),
  graphicInfo(
    {
      id: 'lz-bug',
      name: 'LZ Bug',
      description: 'Small corner graphic: logo or text, with an optional LIVE mark.',
      stepCount: 1,
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string', title: 'Text', default: '' },
          corner: { type: 'string', title: 'Corner', enum: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'], enumNames: ['Top left', 'Top right', 'Bottom left', 'Bottom right'], default: 'topRight' },
          showLogo: { type: 'boolean', title: 'Signet', default: true },
          live: { type: 'boolean', title: 'LIVE mark', default: false },
          opacity: { type: 'integer', title: 'Opacity', minimum: 10, maximum: 100, default: 85 },
        },
      },
      customActions: [{ id: 'pulse', name: 'Pulse', description: 'Draws attention once' }],
    },
    'renderer/graphics/lz-bug',
  ),
  graphicInfo(
    {
      id: 'lz-title',
      name: 'LZ Title',
      description: 'Full-screen title card. Each step shows the next line.',
      stepCount: -1,
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', title: 'Title', default: 'Im Fokus.' },
          subtitle: { type: 'string', title: 'Subtitle', gddType: 'multi-line', default: '' },
          lines: { type: 'array', title: 'Lines (one per step)', items: { type: 'string' }, default: ['Erste Zeile', 'Zweite Zeile'], maxItems: 12 },
          background: { type: 'string', title: 'Background', gddType: 'color-rrggbb', default: '#132040' },
          transparent: { type: 'boolean', title: 'Transparent background', default: false },
        },
      },
    },
    'renderer/graphics/lz-title',
  ),
  graphicInfo(LYRICS, 'renderer/graphics/lz-lyrics'),
]
state.graphics.library = state.graphics.rendererConnected ? LIBRARY : []
state.graphics.layers = [1, 2].map((layer) => ({ layer, graphicId: null, data: {}, status: 'empty', step: 0, error: null }))

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

const getMic = (n) => {
  const m = state.mics.find((x) => x.mic === n)
  need(m, `No such mic: ${n}`)
  return m
}
const getLayer = (n) => {
  const l = state.graphics.layers.find((x) => x.layer === n)
  need(l, `No such graphics layer: ${n}`)
  return l
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
      vfaSim.manual()
      break
    case 'cut':
      need(!state.inTransition, 'Transition running')
      completeTransition()
      vfaSim.manual()
      break
    case 'auto':
      runAuto()
      vfaSim.manual()
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
      vfaSim.manual()
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
    case 'setMic': {
      const m = getMic(c.mic)
      need(typeof c.device === 'string' && c.device, 'Missing device')
      const d = state.audioDevices.find((x) => x.id === c.device)
      need(d, `No such audio device: ${c.device}`)
      need(Number.isInteger(c.channel) && c.channel >= 0 && c.channel < d.channels, `Channel ${c.channel} out of range for ${d.name}`)
      Object.assign(m, { device: c.device, channel: c.channel, status: 'starting', error: null })
      if (typeof c.name === 'string') m.name = c.name
      setTimeout(() => {
        if (m.device !== c.device) return
        m.status = 'running'
        pushState()
      }, 400)
      break
    }
    case 'clearMic':
      Object.assign(getMic(c.mic), { device: null, channel: 0, status: 'empty', error: null })
      break
    case 'micAudio': {
      const m = getMic(c.mic)
      if (typeof c.volume === 'number') m.volume = Math.max(0, Math.min(2, c.volume))
      if (typeof c.muted === 'boolean') m.muted = c.muted
      if (typeof c.inProgram === 'boolean') m.inProgram = c.inProgram
      break
    }
    case 'refreshDevices': {
      const has = state.audioDevices.some((d) => d.id === EXTRA_DEVICE.id)
      state.audioDevices = has ? [...DEVICES] : [...DEVICES, EXTRA_DEVICE]
      for (const m of state.mics) {
        if (!m.device) continue
        const ok = state.audioDevices.some((d) => d.id === m.device)
        m.status = ok ? 'running' : 'error'
        m.error = ok ? null : `Device not found: ${m.device}`
      }
      break
    }
    case 'setVfa': {
      const v = state.vfa
      if (typeof c.enabled === 'boolean') {
        v.enabled = c.enabled
        vfaSim.reset()
      }
      if (Array.isArray(c.rules)) {
        for (const r of c.rules) {
          need(typeof r.source === 'string' && /^(slot|mic):[1-8]$/.test(r.source), `Bad VFA source: ${r.source}`)
          getSlot(r.camera)
        }
        v.rules = c.rules.map((r) => ({ source: r.source, camera: r.camera }))
      }
      if ('wideSlot' in c) {
        if (c.wideSlot != null) getSlot(c.wideSlot)
        v.wideSlot = c.wideSlot
      }
      for (const k of ['thresholdDb', 'dominanceDb', 'attackMs', 'minShotMs', 'silenceMs', 'maxShotMs', 'wideBreakMs'])
        if (typeof c[k] === 'number') v[k] = c[k]
      if (c.transition === 'cut' || c.transition === 'auto') v.transition = c.transition
      break
    }
    case 'gfxLoad': {
      const l = getLayer(c.layer)
      need(state.graphics.rendererConnected, 'Graphics renderer not connected')
      const g = state.graphics.library.find((x) => x.id === c.graphicId)
      need(g, `No such graphic: ${c.graphicId}`)
      Object.assign(l, { graphicId: g.id, data: c.data ?? {}, status: 'loading', step: 0, error: null })
      setTimeout(() => {
        if (l.graphicId !== g.id || l.status !== 'loading') return
        l.status = 'ready'
        pushState()
      }, 350)
      break
    }
    case 'gfxPlay': {
      const l = getLayer(c.layer)
      need(state.graphics.rendererConnected, 'Graphics renderer not connected')
      need(l.graphicId && l.status !== 'loading' && l.status !== 'empty', `Layer ${c.layer} has no graphic loaded`)
      const g = state.graphics.library.find((x) => x.id === l.graphicId)
      const last = g.stepCount > 0 ? g.stepCount - 1 : Infinity
      if (typeof c.goto === 'number') l.step = Math.max(0, Math.min(last, c.goto))
      else if (l.status === 'playing') l.step = Math.min(last, l.step + (c.delta ?? 1))
      else l.step = 0
      l.status = 'playing'
      break
    }
    case 'gfxStop': {
      const l = getLayer(c.layer)
      if (l.status === 'playing') l.status = 'stopped'
      break
    }
    case 'gfxUpdate': {
      const l = getLayer(c.layer)
      need(l.graphicId, `Layer ${c.layer} has no graphic loaded`)
      need(c.data && typeof c.data === 'object', 'Missing data')
      l.data = c.data
      break
    }
    case 'gfxCustom': {
      const l = getLayer(c.layer)
      const g = state.graphics.library.find((x) => x.id === l.graphicId)
      need(g, `Layer ${c.layer} has no graphic loaded`)
      need(g.customActions.some((a) => a.id === c.id), `No such action: ${c.id}`)
      break
    }
    case 'gfxClear':
      Object.assign(getLayer(c.layer), { graphicId: null, data: {}, status: 'empty', step: 0, error: null })
      break
    case 'gfxRescan':
      need(state.graphics.rendererConnected, 'Graphics renderer not connected')
      state.graphics.library = [...LIBRARY]
      break
    default:
      throw new CmdError(`Unknown cmd: ${c.cmd}`)
  }
  pushState()
}

/* ---------- conversation and VFA simulation ---------- */

// A fake talk: someone speaks for a few seconds, sometimes two at once, sometimes nobody.
const talk = { who: [1], until: 0 }
function nextTalk(now) {
  const r = Math.random()
  if (r < 0.12) talk.who = []
  else if (r < 0.22) talk.who = [1 + Math.floor(Math.random() * 3), 1 + Math.floor(Math.random() * 3)]
  else talk.who = [1 + Math.floor(Math.random() * 3)]
  talk.until = now + 1500 + Math.random() * 5000
}

const micSpeech = (n, now) => {
  const m = state.mics.find((x) => x.mic === n)
  if (!m || m.status !== 'running') return -90
  const speaking = talk.who.includes(n)
  // Syllables: speech level wobbles; neighbours' mics pick up some bleed.
  const base = speaking ? -24 + 6 * Math.sin(now / 90 + n) * Math.sin(now / 410 + n * 2) : talk.who.length ? -50 : -64
  return base + Math.random() * 3
}

const vfaSim = {
  candidate: null,
  since: 0,
  shotAt: 0,
  silentSince: 0,
  breakUntil: 0,
  reset() {
    this.candidate = null
    this.since = Date.now()
    this.shotAt = 0
    this.silentSince = Date.now()
    this.breakUntil = 0
  },
  manual() {
    this.shotAt = Date.now()
  },
  cutTo(slot, now) {
    if (slot == null || state.program === slot || state.inTransition) return
    state.preview = slot
    if (state.vfa.transition === 'auto') runAuto()
    else completeTransition()
    this.shotAt = now
  },
  step(speech, now) {
    const v = state.vfa
    const levels = v.rules.map((r) => ({ src: r.source, db: speech[r.source] ?? -90, cam: r.camera }))
    const above = levels.filter((l) => l.db >= v.thresholdDb).sort((a, b) => b.db - a.db)
    let speaker = null
    let crossTalk = false
    if (above.length === 1) speaker = above[0]
    else if (above.length > 1) {
      if (above[0].db - above[1].db >= v.dominanceDb) speaker = above[0]
      else crossTalk = true
    }
    if (speaker) this.silentSince = now
    const key = speaker ? speaker.src : crossTalk ? 'wide' : null
    if (key !== this.candidate) {
      this.candidate = key
      this.since = now
    }
    if (!v.enabled) {
      v.speaking = speaker ? speaker.src : crossTalk ? 'wide' : null
      return
    }
    if (now < this.breakUntil) return
    const shotOk = now - this.shotAt >= v.minShotMs
    if (speaker && now - this.since >= v.attackMs && shotOk) {
      if (v.maxShotMs > 0 && v.speaking === speaker.src && now - this.shotAt >= v.maxShotMs && v.wideSlot != null) {
        v.speaking = 'wide'
        this.cutTo(v.wideSlot, now)
        this.breakUntil = now + v.wideBreakMs
        return
      }
      if (v.speaking !== speaker.src) {
        v.speaking = speaker.src
        this.cutTo(speaker.cam, now)
      }
    } else if ((crossTalk && now - this.since >= v.attackMs) || (!speaker && !crossTalk && now - this.silentSince >= v.silenceMs)) {
      if (shotOk && v.speaking !== 'wide' && v.wideSlot != null) {
        v.speaking = 'wide'
        this.cutTo(v.wideSlot, now)
      }
    }
  },
}
vfaSim.reset()

/* ---------- levels ---------- */

const gainDb = (g) => (g <= 0 ? -90 : 20 * Math.log10(g))
let phase = 0
setInterval(() => {
  const now = Date.now()
  if (now >= talk.until) nextTalk(now)
  phase += 0.1
  const slots = {}
  const speech = {}
  let master = -90
  for (const s of state.slots) {
    let db = -90
    if (s.status === 'running' && s.spec && !s.spec.startsWith('image:') && s.spec !== 'test:black') {
      const tone = s.spec === 'test:smpte' || s.spec === 'test:bars'
      db = tone ? -18 : -24 + 10 * Math.sin(phase * (1 + s.slot * 0.3)) + Math.random() * 4
      speech[`slot:${s.slot}`] = Math.min(0, db - 3)
      db += gainDb(s.audio.volume)
      if (s.audio.muted) db = -90
    } else speech[`slot:${s.slot}`] = -90
    const l = Math.min(0, db)
    const r = Math.min(0, db === -90 ? -90 : db - Math.random() * 2)
    slots[s.slot] = [l, r]
    const audible = !s.audio.afv || s.slot === state.program
    if (audible) master = Math.max(master, l)
  }
  const mics = {}
  for (const m of state.mics) {
    const rms = micSpeech(m.mic, now)
    speech[`mic:${m.mic}`] = rms
    const peak = rms <= -90 || m.muted ? -90 : Math.min(0, rms + 9 + gainDb(m.volume))
    mics[m.mic] = peak
    if (m.inProgram) master = Math.max(master, peak)
  }
  master = state.master.muted || state.ftb ? -90 : Math.min(0, master + gainDb(state.master.volume))
  const before = JSON.stringify([state.vfa.speaking, state.program, state.preview])
  vfaSim.step(speech, now)
  if (JSON.stringify([state.vfa.speaking, state.program, state.preview]) !== before) pushState()
  broadcast({ type: 'levels', levels: { slots, master: [master, master === -90 ? -90 : master - 1], mics, speech } })
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
  if ((m = /^\/api\/vfa\/(on|off|toggle)$/.exec(p)))
    return run(res, { cmd: 'setVfa', enabled: m[1] === 'toggle' ? !state.vfa.enabled : m[1] === 'on' })
  if ((m = /^\/api\/gfx\/(\d+)\/(play|next|stop)$/.exec(p))) {
    const layer = Number(m[1])
    if (m[2] === 'stop') return run(res, { cmd: 'gfxStop', layer })
    return run(res, { cmd: 'gfxPlay', layer, ...(m[2] === 'next' ? { delta: 1 } : {}) })
  }
  if ((m = /^\/api\/vfa\/(on|off|toggle)$/.exec(p)))
    return run(res, { cmd: 'setVfa', enabled: m[1] === 'toggle' ? !state.vfa.enabled : m[1] === 'on' })
  if ((m = /^\/api\/gfx\/(\d+)\/(play|next|stop)$/.exec(p))) {
    const layer = Number(m[1])
    if (m[2] === 'stop') return run(res, { cmd: 'gfxStop', layer })
    return run(res, { cmd: 'gfxPlay', layer, ...(m[2] === 'next' ? { delta: 1 } : {}) })
  }

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
