import { useEffect, useRef, useState } from 'react'
import { dismissError, getState, send, useConn, useMixerState, useServerError } from './client'
import { AudioPanel } from './components/AudioPanel'
import { GraphicsPanel, layerStatus } from './components/GraphicsPanel'
import { Inputs } from './components/Inputs'
import { MicsPanel } from './components/MicsPanel'
import { Multiview } from './components/Multiview'
import { OutputsPanel } from './components/OutputsPanel'
import { OverlayPanel } from './components/OverlayPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { TransitionPanel } from './components/TransitionPanel'
import { Icon, Segmented, StatusSign, Tabs } from './components/ui'
import { VfaPanel, VfaSwitch } from './components/VfaPanel'
import { gfxPlayCommand, keyToAction } from './helpers'
import { getLang, setLang, t } from './i18n'
import type { State } from './types'

type Theme = 'system' | 'dark' | 'light'
type Tab = 'graphics' | 'vfa' | 'mics' | 'audio' | 'overlays' | 'outputs' | 'settings'
const TABS: Tab[] = ['graphics', 'vfa', 'mics', 'audio', 'overlays', 'outputs', 'settings']

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v && (allowed as readonly string[]).includes(v)) return v as T
  } catch {
    // storage blocked
  }
  return fallback
}

function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    // ignore
  }
}

function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  store('theme', theme)
}

/** True while the user is typing, so letters and Space go to the field, not the mixer. */
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'color'].includes(el.type)
  return !!el.closest('dialog[open]')
}

function runKey(e: KeyboardEvent, openHelp: () => void) {
  const a = keyToAction(e)
  if (!a) return
  // A keyboard-focused control keeps Space/Enter for itself; after a mouse click it does not.
  const el = e.target as HTMLElement
  if ((a.kind === 'cut' || a.kind === 'auto') && el !== document.body && el.matches?.(':focus-visible')) return
  const s = getState()
  e.preventDefault()
  switch (a.kind) {
    case 'preview':
    case 'program':
      return send({ cmd: a.kind, slot: a.slot })
    case 'cut':
    case 'auto':
    case 'ftb':
      return send({ cmd: a.kind })
    case 'vfa':
      if (s) send({ cmd: 'setVfa', enabled: !s.vfa.enabled })
      return
    case 'gfxPlay': {
      const layer = s?.graphics.layers.find((l) => l.layer === a.layer)
      const cmd = gfxPlayCommand(layer, s?.graphics.library.find((g) => g.id === layer?.graphicId))
      if (cmd) send(cmd)
      return
    }
    case 'gfxStop': {
      const layer = s?.graphics.layers.find((l) => l.layer === a.layer)
      if (layer?.status === 'playing') send({ cmd: 'gfxStop', layer: a.layer })
      return
    }
    case 'help':
      return openHelp()
  }
}

function useShortcuts(openHelp: () => void) {
  const help = useRef(openHelp)
  help.current = openHelp
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e.target) || document.querySelector('dialog[open]')) return
      runKey(e, () => help.current())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Signet "lz." from the Brand Kit 2.0 (geometry unchanged), single-colour so red stays the on-air signal. */
function Signet() {
  return (
    <svg className="logo signet" viewBox="478.129 455.570 234.046 139.875" role="img" aria-label="Lars Zumpe Medienproduktion">
      <path
        fillRule="nonzero"
        d="M 478.128906 595.445312 L 505.285156 455.570312 L 540.207031 455.570312 L 513.046875 595.445312 Z M 478.128906 595.445312  M638.277 595.445 L555.828 595.445 L561.062 568.285 L610.922 521.727 L570.183 521.727 L575.422 494.566 L657.871 494.566 L652.633 521.727 L602.773 568.285 L643.515 568.285 Z M638.277 595.445"
      />
      <path d="M677.011 595.445 681.538 565.865 H712.175 L707.647 595.445 Z" />
    </svg>
  )
}

function ConnectionState() {
  const conn = useConn()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (conn.status !== 'closed') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [conn.status])
  if (conn.status === 'open') return <StatusSign tone="ok" label={t('Connected')} />
  if (conn.status === 'connecting') return <StatusSign tone="warn" label={t('Connecting…')} />
  const s = Math.max(0, Math.ceil(((conn.retryAt ?? now) - now) / 1000))
  return <StatusSign tone="error" label={`${t('Disconnected, retrying in')} ${s} s`} />
}

function ErrorToast() {
  const err = useServerError()
  useEffect(() => {
    if (!err) return
    const id = setTimeout(dismissError, 6000)
    return () => clearTimeout(id)
  }, [err])
  if (!err) return null
  return (
    <div className="toast" role="alert">
      <span>{err.message}</span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={dismissError}>
        {t('Dismiss')}
      </button>
    </div>
  )
}

/** Automation and graphics at a glance, next to the take buttons. */
function LiveStrip({ state, openTab }: { state: State; openTab: (t: Tab) => void }) {
  const lib = state.graphics.library
  return (
    <div className="live-strip" aria-label={t('Automation and graphics')}>
      <VfaSwitch vfa={state.vfa} compact />
      {state.graphics.layers.map((l) => {
        const st = layerStatus(l)
        const name = lib.find((g) => g.id === l.graphicId)?.name
        return (
          <button
            key={l.layer}
            type="button"
            className={`gfx-chip ${l.status === 'playing' ? 'live' : ''}`}
            onClick={() => openTab('graphics')}
            title={`${t('Graphics')} ${t('Layer')} ${l.layer}${name ? `: ${name}` : ''}`}
          >
            <span className="gfx-chip-num">G{l.layer}</span>
            <StatusSign tone={st.tone} label={st.label} />
          </button>
        )
      })}
    </div>
  )
}

export function App() {
  const state = useMixerState()
  const [lang, setLangState] = useState(getLang())
  const [theme, setTheme] = useState<Theme>(() => readStored('theme', ['system', 'dark', 'light'] as const, 'system'))
  const [tab, setTab] = useState<Tab>(() => readStored('tab', TABS, 'graphics'))
  const [help, setHelp] = useState(false)
  useShortcuts(() => setHelp(true))
  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const openTab = (x: Tab) => {
    setTab(x)
    store('tab', x)
  }

  const tabLabels: Record<Tab, string> = {
    graphics: t('Graphics'),
    vfa: t('VFA'),
    mics: t('Mics'),
    audio: t('Audio'),
    overlays: t('Overlays'),
    outputs: t('Outputs'),
    settings: t('Settings'),
  }
  const badge = (x: Tab) => {
    if (!state) return null
    if (x === 'graphics' && state.graphics.layers.some((l) => l.status === 'playing')) return <i className="tab-dot live" aria-label={t('On air')} />
    if (x === 'vfa' && state.vfa.enabled) return <i className="tab-dot on" aria-label={t('On')} />
    if (x === 'outputs' && state.outputs.some((o) => o.status === 'error')) return <i className="tab-dot error" aria-label={t('Error')} />
    if (x === 'mics' && state.mics.some((m) => m.status === 'error')) return <i className="tab-dot error" aria-label={t('Error')} />
    return null
  }

  return (
    <div className="app" key={lang}>
      <header className="topbar">
        <Signet />
        <h1 className="app-title">Vision Mixer</h1>
        {state && (
          <span className="meta tabular hide-narrow">
            {state.format.name} · v{state.version}
          </span>
        )}
        <span className="spacer" />
        <ConnectionState />
        <button type="button" className="btn btn-icon btn-ghost hide-narrow" onClick={() => setHelp(true)} aria-label={t('Keyboard shortcuts')} title={`${t('Keyboard shortcuts')} (?)`}>
          <Icon name="keyboard" />
        </button>
        <label className="field-inline">
          <span className="sr-only">{t('Language')}</span>
          <select
            value={lang}
            onChange={(e) => {
              const l = e.target.value as 'en' | 'de'
              setLang(l)
              setLangState(l)
            }}
          >
            <option value="en">EN</option>
            <option value="de">DE</option>
          </select>
        </label>
        <Segmented
          className="themes"
          label={t('Theme')}
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: <Icon name="monitor" size={16} />, title: t('System theme') },
            { value: 'light', label: <Icon name="sun" size={16} />, title: t('Light') },
            { value: 'dark', label: <Icon name="moon" size={16} />, title: t('Dark') },
          ]}
        />
      </header>

      <main className="layout">
        <div className="area-main">
          <Multiview state={state} />
          {state && <Inputs state={state} />}
        </div>
        {state ? (
          <aside className="area-side">
            <TransitionPanel state={state} />
            <LiveStrip state={state} openTab={openTab} />
            <section className="secondary">
              <Tabs label={t('More controls')} value={tab} onChange={openTab} tabs={TABS.map((id) => ({ id, label: tabLabels[id], badge: badge(id), icon: id === 'settings' ? ('settings' as const) : undefined }))} />
              <div className="tabpanel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
                {tab === 'graphics' && <GraphicsPanel state={state} />}
                {tab === 'vfa' && <VfaPanel state={state} />}
                {tab === 'mics' && <MicsPanel state={state} />}
                {tab === 'audio' && <AudioPanel state={state} />}
                {tab === 'overlays' && <OverlayPanel state={state} />}
                {tab === 'outputs' && <OutputsPanel state={state} />}
                {tab === 'settings' && <SettingsPanel state={state} />}
              </div>
            </section>
          </aside>
        ) : (
          <p className="waiting">{t('Waiting for the engine…')}</p>
        )}
      </main>
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      <ErrorToast />
    </div>
  )
}
