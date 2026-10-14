// OSC settings: pure helpers and the cheat sheet (docs/api.md, "OSC").

export type TargetProblem = 'empty' | 'format' | 'host' | 'port' | 'duplicate'

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function hostOk(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return /^[0-9a-f:.]+$/i.test(host.slice(1, -1)) && host.includes(':')
  if (IPV4.test(host)) return host.split('.').every((p) => Number(p) <= 255)
  if (/^[\d.]+$/.test(host)) return false
  return HOSTNAME.test(host)
}

/** Checks one feedback target "host:port" (IPv6 as "[::1]:9000"). */
export function oscTargetProblem(raw: string, others: string[] = []): TargetProblem | null {
  const s = raw.trim()
  if (!s) return 'empty'
  const m = /^(\[[^\]]*\]|[^:\s]+):(\d+)$/.exec(s)
  if (!m) return 'format'
  if (!hostOk(m[1])) return 'host'
  const port = Number(m[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'port'
  if (others.some((o) => o.trim().toLowerCase() === s.toLowerCase())) return 'duplicate'
  return null
}

export interface OscEntry {
  address: string
  hint: string
}

/** What the engine receives. */
export const OSC_RECEIVE: OscEntry[] = [
  { address: '/lzvm/cut · /lzvm/auto · /lzvm/ftb', hint: 'Cut, auto transition, fade to black' },
  { address: '/lzvm/preview/<n> · /lzvm/program/<n>', hint: 'Input to preview / hard cut to programme' },
  { address: '/lzvm/tbar f', hint: 'T-bar 0..1' },
  { address: '/lzvm/overlay/<i>/on · /off · /toggle', hint: 'Overlay in or out' },
  { address: '/lzvm/vfa/on · /off · /toggle', hint: 'Video follows audio' },
  { address: '/lzvm/gfx/<l>/play · /next · /stop · /clear', hint: 'Graphics layer' },
  { address: '/lzvm/gfx/<l>/load s:id [s:json]', hint: 'Load a graphic, optionally with data' },
  { address: '/lzvm/gfx/<l>/update s:json', hint: 'Update the graphic on the layer' },
  { address: '/lzvm/caption s:text [i:layer]', hint: 'Text for the captions graphic' },
  { address: '/lzvm/cmd s:json', hint: 'Any API command' },
]

/** What the engine sends to the targets when a value changes. */
export const OSC_FEEDBACK: OscEntry[] = [
  { address: '/lzvm/program i · /lzvm/preview i', hint: 'Input on programme / preview' },
  { address: '/lzvm/tally/<n> i', hint: '0 off, 1 preview, 2 programme' },
  { address: '/lzvm/ftb i · /lzvm/transition i', hint: 'Fade to black, transition running' },
  { address: '/lzvm/vfa i · /lzvm/vfa/speaking s', hint: 'Video follows audio and who speaks' },
  { address: '/lzvm/overlay/<i> i', hint: 'Overlay on air' },
  { address: '/lzvm/gfx/<l>/status s · /onair i', hint: 'Graphics layer state' },
]
