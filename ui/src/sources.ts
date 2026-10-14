// Source kinds of docs/api.md "Source specs": pure helpers (no DOM), unit-tested.
// The source dialog builds a spec from a few fields and reads one back.
import type { Need } from './helpers'
import type { PickKind } from './types'

export type SourceGroupId = 'capture' | 'screen' | 'network' | 'files' | 'decklink' | 'ndi' | 'test'

export type SourceKindId =
  | 'device'
  | 'screen'
  | 'srtListener'
  | 'srtCaller'
  | 'rtmp'
  | 'rtsp'
  | 'udp'
  | 'http'
  | 'whep'
  | 'st2110'
  | 'file'
  | 'image'
  | 'folder'
  | 'sdp'
  | 'decklink'
  | 'ndi'
  | 'test'

/** Form values; which keys a kind uses is fixed per kind. All strings, as typed. */
export type SourceValues = Partial<Record<'device' | 'audio' | 'display' | 'host' | 'port' | 'url' | 'path' | 'n' | 'name' | 'pattern', string>>

export interface SourceKind {
  id: SourceKindId
  group: SourceGroupId
  label: string
  hint: string
  need?: Need
  /** Kind for POST /api/pick: the form gets a Browse button. */
  pick?: PickKind
  defaults: SourceValues
}

export const SOURCE_GROUPS: { id: SourceGroupId; label: string }[] = [
  { id: 'capture', label: 'Cameras & capture' },
  { id: 'screen', label: 'Screen' },
  { id: 'network', label: 'Network' },
  { id: 'files', label: 'Files' },
  { id: 'decklink', label: 'DeckLink' },
  { id: 'ndi', label: 'NDI' },
  { id: 'test', label: 'Test patterns' },
]

export const SOURCE_KINDS: SourceKind[] = [
  { id: 'device', group: 'capture', label: 'Camera or capture card', hint: 'USB camera, HDMI or SDI capture; sound optionally from an audio device', defaults: {} },
  { id: 'screen', group: 'screen', label: 'Screen capture', hint: 'A display of the engine computer', need: 'screen', defaults: { display: '0' } },
  { id: 'srtListener', group: 'network', label: 'SRT listener', hint: 'The mixer waits on a port; the sender connects to it', need: 'srt', defaults: { port: '9000' } },
  { id: 'srtCaller', group: 'network', label: 'SRT caller', hint: 'The mixer connects to a sender that listens', need: 'srt', defaults: { host: '', port: '9000' } },
  { id: 'rtmp', group: 'network', label: 'RTMP', hint: 'Pulls a stream from an RTMP server', defaults: { url: '' } },
  { id: 'rtsp', group: 'network', label: 'RTSP', hint: 'IP cameras and RTSP servers', defaults: { url: '' } },
  { id: 'udp', group: 'network', label: 'UDP MPEG-TS', hint: 'Transport stream on a UDP port, also multicast', defaults: { host: '0.0.0.0', port: '5000' } },
  { id: 'http', group: 'network', label: 'HLS / DASH URL', hint: 'http(s) stream, also .m3u8 and .mpd', defaults: { url: '' } },
  { id: 'whep', group: 'network', label: 'WebRTC (WHEP)', hint: 'WHEP endpoint of OBS, vMix or a WebRTC server', need: 'whep', defaults: { url: '' } },
  { id: 'st2110', group: 'network', label: 'SMPTE ST 2110', hint: 'Reserved; needs the Intel Media Transport Library plugin', need: 'st2110', pick: 'sdp', defaults: { path: '' } },
  { id: 'file', group: 'files', label: 'Video file', hint: 'Plays in a loop', pick: 'video', defaults: { path: '' } },
  { id: 'image', group: 'files', label: 'Still image', hint: 'PNG, JPEG and other images', pick: 'image', defaults: { path: '' } },
  { id: 'folder', group: 'files', label: 'Watch folder', hint: 'Shows the newest image in a folder and switches when a newer one arrives', pick: 'folder', defaults: { path: '' } },
  { id: 'sdp', group: 'files', label: 'SDP file', hint: 'RTP stream described by an SDP file, also AES67 audio', pick: 'sdp', defaults: { path: '' } },
  { id: 'decklink', group: 'decklink', label: 'DeckLink input', hint: 'Video mode is detected automatically', need: 'decklink', defaults: { n: '0' } },
  { id: 'ndi', group: 'ndi', label: 'NDI source', hint: 'Source name as shown in NDI tools, e.g. MACHINE (Camera 1)', need: 'ndi', defaults: { name: '' } },
  { id: 'test', group: 'test', label: 'Test pattern', hint: 'SMPTE and colour bars come with a 1 kHz tone', defaults: { pattern: 'smpte' } },
]

export const TEST_PATTERNS: { id: string; label: string }[] = [
  { id: 'smpte', label: 'SMPTE bars' },
  { id: 'bars', label: 'Colour bars' },
  { id: 'ball', label: 'Bouncing ball' },
  { id: 'black', label: 'Black' },
  { id: 'snow', label: 'Snow' },
]

export const kindById = (id: SourceKindId) => SOURCE_KINDS.find((k) => k.id === id)!

const PATH_PREFIX: Partial<Record<SourceKindId, string>> = { file: 'file:', image: 'image:', folder: 'folder:', sdp: 'sdp:', st2110: 'st2110:' }

function port(v: string | undefined): number | null {
  const s = (v ?? '').trim()
  if (!/^\d{1,5}$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= 65535 ? n : null
}

function index(v: string | undefined): number | null {
  const s = (v ?? '').trim()
  return /^\d{1,3}$/.test(s) ? Number(s) : null
}

/** URL with one of the schemes; a bare host gets the first scheme. */
function url(v: string | undefined, schemes: string[]): string | null {
  const s = (v ?? '').trim()
  if (!s) return null
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s)
  if (!m) return `${schemes[0]}://${s}`
  return schemes.includes(m[1].toLowerCase()) ? s : null
}

/** Host in a URL: IPv6 needs brackets. */
const hostPart = (h: string) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h)

/** The spec for a kind and its form values, or null while something is missing or wrong. */
export function buildSpec(kind: SourceKindId, v: SourceValues): string | null {
  const text = (k: keyof SourceValues) => (v[k] ?? '').trim()
  switch (kind) {
    case 'device':
      if (!text('device')) return null
      return `device:${text('device')}${text('audio') ? `#audio=${text('audio')}` : ''}`
    case 'screen': {
      const n = index(v.display)
      return n == null ? null : `screen:${n}`
    }
    case 'srtListener': {
      const p = port(v.port)
      return p == null ? null : `srt://0.0.0.0:${p}?mode=listener`
    }
    case 'srtCaller': {
      const p = port(v.port)
      return p == null || !text('host') ? null : `srt://${hostPart(text('host'))}:${p}?mode=caller`
    }
    case 'udp': {
      const p = port(v.port)
      return p == null ? null : `udp://${hostPart(text('host') || '0.0.0.0')}:${p}`
    }
    case 'rtmp':
      return url(v.url, ['rtmp', 'rtmps'])
    case 'rtsp':
      return url(v.url, ['rtsp', 'rtsps'])
    case 'http':
      return url(v.url, ['https', 'http'])
    case 'whep': {
      const u = url(v.url, ['https', 'http'])
      return u ? `whep:${u}` : null
    }
    case 'file':
    case 'image':
    case 'folder':
    case 'sdp':
    case 'st2110':
      return text('path') ? `${PATH_PREFIX[kind]}${text('path')}` : null
    case 'decklink': {
      const n = index(v.n)
      return n == null ? null : `decklink:${n}`
    }
    case 'ndi':
      return text('name') ? `ndi:${text('name')}` : null
    case 'test':
      return TEST_PATTERNS.some((p) => p.id === v.pattern) ? `test:${v.pattern}` : null
  }
}

/** Kind and form values for a spec, so the dialog opens on what an input plays. Null = only free text. */
export function parseSpec(spec: string | null | undefined): { kind: SourceKindId; values: SourceValues } | null {
  const s = (spec ?? '').trim()
  let m: RegExpExecArray | null
  if ((m = /^device:([^#]+?)(?:#audio=(.+))?$/.exec(s))) return { kind: 'device', values: { device: m[1], audio: m[2] ?? '' } }
  if ((m = /^screen:(\d+)$/.exec(s))) return { kind: 'screen', values: { display: m[1] } }
  if ((m = /^srt:\/\/(\[[^\]]+\]|[^:/?]*):(\d+)(?:\?(.*))?$/i.exec(s))) {
    const mode = /(?:^|&)mode=([a-z]+)/i.exec(m[3] ?? '')?.[1]?.toLowerCase()
    const host = m[1].replace(/^\[|\]$/g, '')
    if (mode === 'listener') return { kind: 'srtListener', values: { port: m[2] } }
    if (!m[3] || mode === 'caller') return { kind: 'srtCaller', values: { host, port: m[2] } }
    return null
  }
  if ((m = /^udp:\/\/@?(\[[^\]]+\]|[^:/?]*):(\d+)$/i.exec(s))) return { kind: 'udp', values: { host: m[1].replace(/^\[|\]$/g, ''), port: m[2] } }
  if (/^rtmps?:\/\/./i.test(s)) return { kind: 'rtmp', values: { url: s } }
  if (/^rtsps?:\/\/./i.test(s)) return { kind: 'rtsp', values: { url: s } }
  if (/^https?:\/\/./i.test(s)) return { kind: 'http', values: { url: s } }
  if ((m = /^whep:(.+)$/.exec(s))) return { kind: 'whep', values: { url: m[1] } }
  for (const [kind, prefix] of Object.entries(PATH_PREFIX) as [SourceKindId, string][])
    if (s.startsWith(prefix) && s.length > prefix.length) return { kind, values: { path: s.slice(prefix.length) } }
  if ((m = /^decklink:(\d+)$/.exec(s))) return { kind: 'decklink', values: { n: m[1] } }
  if ((m = /^ndi:(.+)$/.exec(s))) return { kind: 'ndi', values: { name: m[1] } }
  if ((m = /^test:(\w+)$/.exec(s)) && TEST_PATTERNS.some((p) => p.id === m![1])) return { kind: 'test', values: { pattern: m[1] } }
  return null
}

/** Values to start a kind with; a camera starts on the first device found. */
export function initialValues(kind: SourceKindId, firstDevice?: string): SourceValues {
  const d = { ...kindById(kind).defaults }
  if (kind === 'device' && firstDevice) d.device = firstDevice
  return d
}
