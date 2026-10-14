// Mock of the LZ Vision Mixer engine for UI development (docs/api.md).
// Simulates state, commands, transitions, levels and the multiview stream.
// Also microphones, video follows audio (with a fake conversation) and OGraf graphics.
// Also adding/removing inputs and mics, the multiview layout, the file picker and load/forecast.
// Run: npm run mock   (PORT=4295 to avoid a running engine, MOCK_DECKLINK=1 pretends
// DeckLink hardware exists, MOCK_NO_RENDERER=1 starts without a graphics renderer,
// MOCK_INPUTS=12 starts with that many inputs, MOCK_PICK_CANCEL=1 makes every file
// dialog "cancelled", MOCK_BUSY=1 lets other programs eat the CPU)
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 4195
const HOST = '127.0.0.1'
// Fallback picture; with ffmpeg on the PATH the mock draws one that matches the layout.
const STATIC_FRAME = readFileSync(join(here, 'multiview.jpg'))
let FRAME = STATIC_FRAME
const DIST = join(here, '..', 'dist')

const slot = (n, name, spec, extra = {}) => ({
  slot: n,
  name,
  spec,
  status: spec ? 'running' : 'empty',
  error: null,
  audio: { volume: 1, muted: false, afv: true, delayMs: 0 },
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
  audioOutputs: [],
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
  osc: { listen: process.env.MOCK_OSC_OFF === '1' ? null : '127.0.0.1:4210', targets: ['127.0.0.1:12321'] },
}
state.slots[6].status = state.capabilities.decklink ? 'running' : 'error'
if (state.capabilities.decklink) state.slots[6].error = null

/* ---------- more inputs, video devices, multiview layout ---------- */

// MOCK_INPUTS=12: a bigger show. Extra inputs are cameras, streams and files.
const EXTRA_INPUTS = [
  ['Camera 2', 'device:avf:0'],
  ['Camera 3', 'device:avf:1#audio=coreaudio:usb-codec'],
  ['Remote guest', 'srt://0.0.0.0:9001?mode=listener'],
  ['Slides', 'screen:1'],
  ['Stage', 'rtsp://192.168.1.50:554/stream1'],
  ['Phone', 'whep:https://mixer.local/whep/phone'],
  ['Crowd cam', 'device:avf:2'],
  ['Sponsor loop', 'file:/clips/sponsors.mp4'],
  ['Drone', 'udp://0.0.0.0:5000'],
  ['Photo booth', 'folder:/Users/booth/Outbox'],
  ['Stream', 'https://cdn.example.com/live/index.m3u8'],
  ['Lyrics PC', 'ndi:LYRICS-PC (Output)'],
]
for (let i = state.slots.length; i < (Number(process.env.MOCK_INPUTS) || 8); i++) {
  const [name, spec] = EXTRA_INPUTS[(i - 8) % EXTRA_INPUTS.length]
  state.slots.push(slot(i + 1, name, spec))
}
// Input numbers are never reused while running (docs/api.md), even after removing the highest.
let nextSlotNumber = Math.max(0, ...state.slots.map((x) => x.slot)) + 1

const VIDEO_DEVICES = [
  { id: 'avf:0', name: 'FaceTime HD Camera' },
  { id: 'avf:1', name: 'Cam Link 4K' },
  { id: 'avf:2', name: 'Blackmagic Web Presenter HD' },
]
const EXTRA_VIDEO = { id: 'avf:3', name: 'OBSBOT Tiny 2' }
state.videoDevices = [...VIDEO_DEVICES]

// Exactly the engine's layout: four columns up to eight inputs, then more columns
// until all rows fit the lower half; integer pixels.
const MV_W = 1280
const MV_H = 720
function mvTiles(count) {
  let cols = 4
  for (;;) {
    const w = Math.floor(MV_W / cols)
    const h = Math.floor((w * 9) / 16)
    const rows = Math.max(1, Math.ceil(count / cols))
    if (rows * h <= MV_H / 2 || cols >= Math.max(count, 4))
      return Array.from({ length: count }, (_, i) => ({ x: (i % cols) * w, y: MV_H / 2 + Math.floor(i / cols) * h, w, h }))
    cols++
  }
}
function updateMultiview() {
  state.multiview = {
    width: MV_W,
    height: MV_H,
    preview: { x: 0, y: 0, w: MV_W / 2, h: MV_H / 2 },
    program: { x: MV_W / 2, y: 0, w: MV_W / 2, h: MV_H / 2 },
    tiles: mvTiles(state.slots.length).map((a, i) => ({ slot: state.slots[i].slot, ...a })),
  }
}
updateMultiview()

/* ---------- audio devices and mics ---------- */

const DEVICES = [
  { id: 'coreaudio:builtin', name: 'MacBook Pro Microphone', channels: 1 },
  { id: 'coreaudio:usb-codec', name: 'USB Audio CODEC', channels: 2 },
  { id: 'coreaudio:scarlett-18i8', name: 'Scarlett 18i8 USB', channels: 8 },
]
// "Refresh devices" plugs a recorder in or out, so the refresh is visible.
const EXTRA_DEVICE = { id: 'coreaudio:podtrak-p4', name: 'PodTrak P4', channels: 4 }
state.audioDevices = [...DEVICES]
const OUT_DEVICES = [
  { id: 'coreaudio:builtin-out', name: 'MacBook Pro Speakers', channels: 2 },
  { id: 'coreaudio:scarlett-18i8-out', name: 'Scarlett 18i8 USB', channels: 8 },
  { id: 'coreaudio:blackhole-2ch', name: 'BlackHole 2ch', channels: 2 },
]
const EXTRA_OUT = { id: 'coreaudio:podtrak-p4-out', name: 'PodTrak P4', channels: 2 }
state.audioOutputs = [...OUT_DEVICES]

// Channel strip: neutral defaults and the contract ranges (docs/api.md, Strip).
const STRIP_DEFAULT = {
  hpfHz: 0,
  gate: false,
  gateThresholdDb: -50,
  gateRangeDb: 20,
  comp: false,
  compThresholdDb: -20,
  compRatio: 3,
  compAttackMs: 10,
  compReleaseMs: 150,
  makeupDb: 0,
  denoise: false,
}
const STRIP_LIMITS = {
  gateThresholdDb: [-90, 0],
  gateRangeDb: [0, 90],
  compThresholdDb: [-60, 0],
  compRatio: [1, 20],
  compAttackMs: [0.1, 200],
  compReleaseMs: [10, 2000],
  makeupDb: [-20, 24],
}
const SPEECH = {
  denoise: true,
  hpfHz: 80,
  gate: true,
  gateThresholdDb: -50,
  gateRangeDb: 20,
  comp: true,
  compThresholdDb: -20,
  compRatio: 3,
  compAttackMs: 10,
  compReleaseMs: 150,
  makeupDb: 3,
}

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
  delayMs: 0,
  ...extra,
  strip: { ...STRIP_DEFAULT, ...extra.strip },
})
state.mics = [
  mic(1, 'Host', 'coreaudio:scarlett-18i8', 0, { strip: SPEECH, delayMs: 40 }),
  mic(2, 'Guest 1', 'coreaudio:scarlett-18i8', 1, { strip: { hpfHz: 100, comp: true, compRatio: 2.5 } }),
  mic(3, 'Guest 2', 'coreaudio:scarlett-18i8', 2),
  mic(4, 'Room', 'coreaudio:usb-codec', 0, { inProgram: false }),
  mic(5, 'Phone', 'coreaudio:podtrak-p4', 0, { status: 'error', error: 'Device not found: coreaudio:podtrak-p4' }),
  mic(6, 'Spare'),
  mic(7),
  mic(8),
]
let nextMicNumber = 9

/* ---------- graphics library (what the renderer bundles) ---------- */

const LYRICS = JSON.parse(readFileSync(join(here, 'lyrics.ograf.json'), 'utf8'))
const CAPTIONS_FILE = join(here, '..', '..', 'renderer', 'graphics', 'lz-captions', 'captions.ograf.json')
const CAPTIONS = existsSync(CAPTIONS_FILE)
  ? JSON.parse(readFileSync(CAPTIONS_FILE, 'utf8'))
  : { id: 'lz-captions', name: 'LZ Captions', schema: { type: 'object', properties: { text: { type: 'string', title: 'Text', default: '' } } } }
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
  graphicInfo(CAPTIONS, 'renderer/graphics/lz-captions'),
]
state.graphics.library = state.graphics.rendererConnected ? LIBRARY : []
state.graphics.layers = [1, 2].map((layer) => ({ layer, graphicId: null, data: {}, status: 'empty', step: 0, error: null }))

/* ---------- broadcasting ---------- */

const clients = new Set()
function broadcast(msg) {
  const s = JSON.stringify(msg)
  for (const c of clients) if (c.readyState === 1) c.send(s)
}
const pushState = () => {
  updateMultiview()
  renderFrame()
  broadcast({ type: 'state', state })
}

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
  const m = /^(test|decklink|ndi|file|image|folder|sdp|st2110|device|screen|whep):(.*)$/.exec(spec)
  if (!m) return spec.split('?')[0].replace(/^\w+:\/\//, '')
  if (m[1] === 'test') return m[2].toUpperCase()
  if (m[1] === 'decklink') return `DeckLink ${Number(m[2]) + 1}`
  if (m[1] === 'screen') return `Screen ${Number(m[2]) + 1}`
  if (m[1] === 'device') return state.videoDevices.find((d) => d.id === m[2].split('#')[0])?.name ?? m[2]
  if (m[1] === 'whep') return 'WebRTC'
  return m[2].split('/').pop() || m[1]
}

function sourceProblem(spec) {
  if (spec.startsWith('decklink:') && !state.capabilities.decklink) return 'DeckLink not available'
  if (spec.startsWith('ndi:') && !state.capabilities.ndi) return 'NDI not available'
  if (spec.startsWith('srt://') && !state.capabilities.srt) return 'SRT not available'
  if (spec.startsWith('st2110:')) return 'ST 2110 is not wired yet'
  if (
    !/^(test:(smpte|bars|ball|black|snow)|decklink:\d+|ndi:.+|device:[^#]+(#audio=.+)?|screen:\d+|whep:https?:\/\/.+|(srt|rtmps?|rtsps?|https?|udp):\/\/.+|(file|image|folder|sdp):.+|st2110:.+)$/.test(
      spec,
    )
  )
    return `Unknown source spec: ${spec}`
  const dev = /^device:([^#]+)(?:#audio=(.+))?$/.exec(spec)
  if (dev && !state.videoDevices.some((d) => d.id === dev[1])) return `Video device not found: ${dev[1]}`
  if (dev?.[2] && !state.audioDevices.some((d) => d.id === dev[2])) return `Audio device not found: ${dev[2]}`
  if (/^screen:[4-9]/.test(spec)) return `No display ${spec.slice(7)}`
  return null
}

function delay(v) {
  need(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 500, 'delayMs must be 0..500')
  return Math.round(v)
}

function outputProblem(spec) {
  if (spec.startsWith('audio:') && !state.audioOutputs.some((d) => `audio:${d.id}` === spec)) return `Audio device not found: ${spec.slice(6)}`
  if (spec.startsWith('decklink') && !state.capabilities.decklink) return 'DeckLink not available'
  if (spec.startsWith('ndi:') && !state.capabilities.ndi) return 'NDI not available'
  if (spec.startsWith('srt://') && !state.capabilities.srt) return 'SRT not available'
  return null
}

let outputSeq = 1

function startInput(s, spec, name, problem) {
  s.spec = spec
  s.name = name || nameFromSpec(spec)
  s.status = 'starting'
  s.error = null
  setTimeout(() => {
    if (s.spec !== spec || !state.slots.includes(s)) return
    s.status = problem ? 'error' : 'running'
    s.error = problem
    pushState()
  }, 700)
}

function apply(c) {
  need(c && typeof c.cmd === 'string', 'Missing cmd')
  switch (c.cmd) {
    case 'addInput': {
      if (c.spec != null) need(typeof c.spec === 'string' && c.spec.trim(), 'spec must be a non-empty string')
      const problem = c.spec ? sourceProblem(c.spec) : null
      need(!problem || !problem.startsWith('Unknown'), problem)
      const s = slot(nextSlotNumber++, '', null)
      state.slots.push(s)
      if (c.spec) {
        startInput(s, c.spec, c.name, problem)
      } else if (typeof c.name === 'string') s.name = c.name.trim()
      break
    }
    case 'removeInput': {
      const s = getSlot(c.slot)
      need(!(state.inTransition && (state.program === s.slot || state.preview === s.slot)), `Input ${s.slot} is in a running transition`)
      state.slots = state.slots.filter((x) => x !== s)
      if (state.program === s.slot) state.program = null
      if (state.preview === s.slot) state.preview = null
      for (const o of state.overlays)
        if (o.slot === s.slot) {
          o.slot = null
          o.onAir = false
        }
      if (state.vfa.wideSlot === s.slot) state.vfa.wideSlot = null
      state.vfa.rules = state.vfa.rules.filter((r) => r.camera !== s.slot && r.source !== `slot:${s.slot}`)
      break
    }
    case 'addMic': {
      const m = mic(nextMicNumber++, typeof c.name === 'string' ? c.name.trim() : '')
      state.mics.push(m)
      break
    }
    case 'removeMic': {
      const m = getMic(c.mic)
      state.mics = state.mics.filter((x) => x !== m)
      state.vfa.rules = state.vfa.rules.filter((r) => r.source !== `mic:${m.mic}`)
      break
    }
    case 'setInput': {
      const s = getSlot(c.slot)
      need(typeof c.spec === 'string' && c.spec.trim(), 'Missing spec')
      const problem = sourceProblem(c.spec)
      need(!problem || !problem.startsWith('Unknown'), problem)
      startInput(s, c.spec, c.name, problem)
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
      if ('delayMs' in c) s.audio.delayMs = delay(c.delayMs)
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
      need(/^(decklink(-mv)?:\d+|ndi:.+|srt:\/\/.+|rtmp:\/\/.+|record:.+|audio:.+)$/.test(c.spec), `Unknown output spec: ${c.spec}`)
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
      if (typeof c.stereo === 'boolean') m.stereo = c.stereo
      need(!m.stereo || c.channel + 1 < d.channels, `${d.name} has ${d.channels} channels; channel ${c.channel + 2} does not exist`)
      Object.assign(m, { device: c.device, channel: c.channel, status: 'starting', error: null })
      if (typeof c.name === 'string') m.name = c.name
      setTimeout(() => {
        if (m.device !== c.device) return
        m.status = 'running'
        pushState()
      }, 400)
      break
    }
    case 'renameMic':
      need(typeof c.name === 'string', 'Missing name')
      getMic(c.mic).name = c.name.trim()
      break
    case 'micStrip': {
      const m = getMic(c.mic)
      need(c.strip && typeof c.strip === 'object', 'Missing strip')
      const next = { ...m.strip }
      for (const [k, v] of Object.entries(c.strip)) {
        need(k in STRIP_DEFAULT, `Unknown strip field: ${k}`)
        if (typeof STRIP_DEFAULT[k] === 'boolean') {
          need(typeof v === 'boolean', `${k} must be true or false`)
        } else {
          need(typeof v === 'number' && Number.isFinite(v), `${k} must be a number`)
          if (k === 'hpfHz') need(v === 0 || (v >= 20 && v <= 400), 'hpfHz must be 0 or 20..400')
          else need(v >= STRIP_LIMITS[k][0] && v <= STRIP_LIMITS[k][1], `${k} must be ${STRIP_LIMITS[k][0]}..${STRIP_LIMITS[k][1]}`)
        }
        next[k] = v
      }
      const restart = next.denoise !== m.strip.denoise && m.device
      m.strip = next
      if (restart && m.status === 'running') {
        // Like the engine: switching denoise rebuilds the mic pipeline.
        m.status = 'starting'
        setTimeout(() => {
          if (m.status !== 'starting') return
          m.status = 'running'
          pushState()
        }, 600)
      }
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
      if ('delayMs' in c) m.delayMs = delay(c.delayMs)
      break
    }
    case 'refreshDevices': {
      const has = state.audioDevices.some((d) => d.id === EXTRA_DEVICE.id)
      state.audioDevices = has ? [...DEVICES] : [...DEVICES, EXTRA_DEVICE]
      state.audioOutputs = has ? [...OUT_DEVICES] : [...OUT_DEVICES, EXTRA_OUT]
      state.videoDevices = has ? [...VIDEO_DEVICES] : [...VIDEO_DEVICES, EXTRA_VIDEO]
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
          need(typeof r.source === 'string' && /^(slot|mic):[1-9]\d*$/.test(r.source), `Bad VFA source: ${r.source}`)
          const [kind, n] = r.source.split(':')
          if (kind === 'mic') getMic(Number(n))
          else getSlot(Number(n))
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
    case 'setOscTargets': {
      need(Array.isArray(c.targets), 'targets must be an array')
      const seen = new Set()
      for (const t of c.targets) {
        need(typeof t === 'string', 'Each target is a "host:port" string')
        const m = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):(\d+)$/.exec(t.trim())
        need(m, `Bad OSC target: ${t} (use host:port)`)
        const port = Number(m[2])
        need(port >= 1 && port <= 65535, `Bad OSC port: ${t}`)
        need(!seen.has(t.trim().toLowerCase()), `Duplicate OSC target: ${t}`)
        seen.add(t.trim().toLowerCase())
      }
      state.osc.targets = c.targets.map((t) => t.trim())
      break
    }
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

/* ---------- load and forecast ---------- */

// Like the engine: cost per input and mic is "estimate" (defaults) until the number of
// running inputs has changed while running; then it is "measured" on this (pretend) machine.
const CORES = 10
const TRUE_PER_INPUT = 36 // % of one core, what an input really costs here
const TRUE_PER_MIC = 1.4
const perfModel = {
  counts: new Set(),
  slow: 0,
  sample() {
    const inputs = state.slots.filter((x) => x.status === 'running').length
    const mics = state.mics.filter((m) => m.status === 'running').length
    this.counts.add(inputs)
    const jitter = () => Math.random() * 2 - 1
    const coreLoad = 22 + TRUE_PER_INPUT * inputs + TRUE_PER_MIC * mics + 3 * jitter()
    const cpu = Math.max(0.5, coreLoad / CORES)
    const others = (process.env.MOCK_BUSY === '1' ? 48 : 13) + 2 * jitter()
    const systemCpu = Math.min(100, cpu + others)
    const nominal = state.format.fps
    // Past ~92 % the machine cannot keep up: frames drop.
    const outputFps = systemCpu > 92 ? Math.round(nominal * (0.8 + Math.random() * 0.08) * 10) / 10 : nominal
    this.slow = outputFps < nominal * 0.95 ? this.slow + 1 : 0
    const overloaded = this.slow >= 2
    const measured = this.counts.size >= 2
    const perInput = measured ? TRUE_PER_INPUT + 0.4 : 45
    const perMic = measured ? TRUE_PER_MIC + 0.1 : 2
    const room = (80 - systemCpu) * CORES
    const fit = (cost) => (overloaded || room <= 0 ? 0 : Math.floor(room / cost))
    const processMemoryMb = Math.round(420 + 85 * inputs + 6 * mics + 10 * jitter())
    return {
      cpu: Math.round(cpu * 10) / 10,
      systemCpu: Math.round(systemCpu * 10) / 10,
      cores: CORES,
      memoryUsedMb: 14200 + processMemoryMb,
      memoryTotalMb: 32768,
      processMemoryMb,
      outputFps,
      nominalFps: nominal,
      overloaded,
      runningInputs: inputs,
      runningMics: mics,
      forecast: {
        moreInputs: fit(perInput),
        moreMics: fit(perMic),
        perInput: Math.round(perInput * 10) / 10,
        perMic: Math.round(perMic * 10) / 10,
        basis: measured ? 'measured' : 'estimate',
      },
    }
  },
}
let perf = perfModel.sample()
setInterval(() => {
  perf = perfModel.sample()
  broadcast({ type: 'perf', perf })
}, 1000)

/* ---------- multiview picture ---------- */

// Draws a frame that matches state.multiview with ffmpeg (if installed): programme and
// preview on top, one tile per input. Rendered again whenever the layout or a source changes.
const lavfiSource = (s, w, h) => {
  const size = `s=${w}x${h}`
  if (!s || !s.spec || s.status === 'empty') return `color=c=0x080808:${size}`
  if (s.status === 'error') return `color=c=0x2a1210:${size}`
  const spec = s.spec
  if (spec === 'test:smpte') return `smptehdbars=${size}`
  if (spec === 'test:bars') return `smptebars=${size}`
  if (spec === 'test:black') return `color=c=black:${size}`
  if (spec === 'test:snow') return `nullsrc=${size},format=gray,geq=lum='random(1)*255'`
  if (spec === 'test:ball')
    return `color=c=0x15151a:${size},drawbox=x=${Math.round(w * 0.45)}:y=${Math.round(h * 0.42)}:w=${Math.round(h * 0.16)}:h=${Math.round(h * 0.16)}:color=0xe8e8e8:t=fill`
  const hue = [...spec].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const tint = (n) => `0x${[0, 1, 2].map((i) => (((hue >> (i * 5)) & 0x3f) + n).toString(16).padStart(2, '0')).join('')}`
  if (/^(file|image|folder):/.test(spec)) return `gradients=${size}:c0=${tint(10)}:c1=${tint(120)}:x0=0:y0=0:x1=${w}:y1=${h}:n=2`
  if (/^(device|screen|decklink):/.test(spec)) return `testsrc2=${size}`
  return `gradients=${size}:c0=${tint(20)}:c1=${tint(90)}:x0=0:y0=${h}:x1=${w}:y1=0:n=2`
}
let frameKey = ''
let rendering = false
function renderFrame() {
  const mv = state.multiview
  const bySlot = (n) => state.slots.find((x) => x.slot === n)
  const key = JSON.stringify([mv, state.program, state.preview, state.slots.map((x) => [x.slot, x.spec, x.status])])
  if (key === frameKey || rendering) return
  rendering = true
  const areas = [
    [mv.preview, bySlot(state.preview)],
    [mv.program, bySlot(state.program)],
    ...mv.tiles.map((t) => [t, bySlot(t.slot)]),
  ]
  let graph = `color=c=0x080808:s=${MV_W}x${MV_H}[l0]`
  areas.forEach(([a, s], i) => {
    graph += `;${lavfiSource(s, a.w, a.h)},format=yuv420p[s${i}];[l${i}][s${i}]overlay=${a.x}:${a.y}[l${i + 1}]`
  })
  graph += `;[l${areas.length}]format=yuvj420p[out0]`
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', graph, '-frames:v', '1', '-q:v', '4', '-f', 'mjpeg', 'pipe:1'])
  const chunks = []
  ff.stdout.on('data', (d) => chunks.push(d))
  ff.on('error', () => {
    // No ffmpeg: keep the static picture.
    rendering = false
    frameKey = key
  })
  ff.on('close', (code) => {
    rendering = false
    if (code === 0 && chunks.length) FRAME = Buffer.concat(chunks)
    frameKey = key
    renderFrame() // catch changes that came in meanwhile
  })
}
renderFrame()

/* ---------- file picker ---------- */

const PICKED = {
  video: '/Users/lars/Movies/Opener.mp4',
  image: '/Users/lars/Pictures/Sponsor.png',
  folder: '/Users/lars/Pictures/Photobooth',
  sdp: '/Users/lars/Streams/aes67-stage.sdp',
  save: '/Users/lars/Movies/Recording.mp4',
}

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
  if (p === '/api/perf') return json(res, 200, perf)
  if (p === '/api/pick' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      let kind
      try {
        kind = JSON.parse(body).kind
      } catch {
        return json(res, 400, { error: 'Invalid JSON' })
      }
      if (!(kind in PICKED)) return json(res, 400, { error: `kind: unknown variant \`${kind}\`` })
      // The real dialog takes a moment; the user picks or cancels.
      setTimeout(() => json(res, 200, process.env.MOCK_PICK_CANCEL === '1' ? { cancelled: true } : { path: PICKED[kind] }), 600)
    })
    return
  }
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
    ws.send(JSON.stringify({ type: 'perf', perf }))
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
