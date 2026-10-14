// Status window: engine connection, layers (with optional preview) and the graphics library.

import { translator, type Key } from './i18n.js'

interface LayerView {
  layer: number
  graphicId: string | null
  status: 'empty' | 'loading' | 'ready' | 'playing' | 'stopped' | 'error'
  step: number
  error: string | null
  frames: { connected: boolean; sent: number; dropped: number }
}
interface StatusState {
  engine: { url: string; connected: boolean }
  format: { width: number; height: number; fps: number } | null
  layers: LayerView[]
  library: { id: string; name: string; description: string; path: string; stepCount: number }[]
  warnings: string[]
  roots: string[]
  preview: boolean
}
interface StatusApi {
  get(): Promise<StatusState>
  onState(cb: (s: StatusState) => void): void
  onPreview(cb: (p: { layer: number; dataUrl: string }) => void): void
  setPreview(on: boolean): void
  rescan(): void
  openFolder(): void
}

const api = (window as unknown as { lzStatus: StatusApi }).lzStatus
const lang = navigator.language || 'en'
const t = translator(lang)
document.documentElement.lang = lang.toLowerCase().startsWith('de') ? 'de' : 'en'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = t(node.dataset.i18n as Key)
document.title = `LZ Vision Mixer – ${t('title')}`

// Theme: Auto / Light / Dark, remembered per machine.
function applyTheme(choice: string): void {
  if (choice === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) {
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice))
  }
  try {
    localStorage.setItem('theme', choice)
  } catch {
    // storage unavailable: choice lasts for this session
  }
}
let savedTheme = 'auto'
try {
  savedTheme = localStorage.getItem('theme') ?? 'auto'
} catch {
  // ignore
}
applyTheme(savedTheme)
$('theme').addEventListener('click', (e) => {
  const choice = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-choice]')?.dataset.themeChoice
  if (choice) applyTheme(choice)
})

$('rescan').addEventListener('click', () => api.rescan())
$('open-folder').addEventListener('click', () => api.openFolder())
const previewBox = $<HTMLInputElement>('preview')
previewBox.addEventListener('change', () => api.setPreview(previewBox.checked))

const previews = new Map<number, HTMLImageElement>()

const pillClass: Record<LayerView['status'], string> = {
  empty: '',
  loading: 'warn',
  ready: 'ok',
  playing: 'live',
  stopped: '',
  error: 'error',
}

function render(s: StatusState): void {
  const engineState = $('engine-state')
  engineState.textContent = s.engine.connected ? t('connected') : t('waiting')
  engineState.className = `pill ${s.engine.connected ? 'ok' : 'warn'}`
  $('engine-url').textContent = s.engine.url
  $('engine-format').textContent = s.format
    ? t('format', { w: s.format.width, h: s.format.height, fps: s.format.fps })
    : t('noFormat')
  previewBox.checked = s.preview

  const layers = $('layers')
  layers.replaceChildren()
  if (!s.layers.length) layers.append(el('p', 'empty', t('noLayers')))
  for (const l of s.layers) {
    const box = el('div', 'layer')
    const head = el('div', 'row')
    const graphic = s.library.find((g) => g.id === l.graphicId)
    const name = graphic?.name ?? l.graphicId
    head.append(el('span', 'title', `${t('layer', { n: l.layer })}${name ? ` · ${name}` : ''}`))
    const multiStep = graphic ? graphic.stepCount === -1 || graphic.stepCount > 1 : false
    const status = t(`status.${l.status}` as Key) + (l.status === 'playing' && multiStep ? ` · ${t('step', { n: l.step + 1 })}` : '')
    head.append(el('span', `pill ${pillClass[l.status]}`, status))
    box.append(head)
    if (l.error) box.append(el('p', 'err', l.error))
    box.append(
      el('p', 'meta', l.frames.connected ? `${t('frameSocket')}: ${t('frames', { sent: l.frames.sent, dropped: l.frames.dropped })}` : t('frameSocketDown')),
    )
    if (s.preview) {
      let img = previews.get(l.layer)
      if (!img) {
        img = document.createElement('img')
        img.className = 'preview'
        img.alt = t('layer', { n: l.layer })
        previews.set(l.layer, img)
      }
      box.append(img)
    }
    layers.append(box)
  }

  const lib = $('library')
  lib.replaceChildren()
  if (!s.library.length) lib.append(el('li', 'empty', t('noGraphics')))
  for (const g of s.library) {
    const li = el('li')
    li.title = g.path
    const top = el('div')
    top.append(el('span', 'name', g.name), el('span', 'meta mono id', g.id))
    li.append(top)
    const steps = g.stepCount === -1 ? t('dynamicSteps') : g.stepCount > 1 ? t('steps', { n: g.stepCount }) : ''
    const desc = [g.description, steps].filter(Boolean).join(' · ')
    if (desc) li.append(el('p', 'meta', desc))
    lib.append(li)
  }

  const wbox = $('warnings-box')
  wbox.hidden = !s.warnings.length
  $('warnings-title').textContent = t('warnings', { n: s.warnings.length })
  $('warnings').replaceChildren(...s.warnings.map((w) => el('li', '', w)))
  $('roots').replaceChildren(...s.roots.map((r) => el('li', '', r)))
}

api.onState(render)
api.onPreview(({ layer, dataUrl }) => {
  const img = previews.get(layer)
  if (img) img.src = dataUrl
})
void api.get().then(render)
