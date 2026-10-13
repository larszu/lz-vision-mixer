import { useEffect, useState } from 'react'
import { dismissError, send, useConn, useMixerState, useServerError } from './client'
import { AudioPanel } from './components/AudioPanel'
import { Inputs } from './components/Inputs'
import { Multiview } from './components/Multiview'
import { OutputsPanel } from './components/OutputsPanel'
import { OverlayPanel } from './components/OverlayPanel'
import { TransitionPanel } from './components/TransitionPanel'
import { StatusSign } from './components/ui'
import { keyToAction } from './helpers'
import { getLang, setLang, t } from './i18n'

type Theme = 'system' | 'dark' | 'light'

function readTheme(): Theme {
  try {
    const v = localStorage.getItem('theme')
    if (v === 'dark' || v === 'light') return v
  } catch {
    // storage blocked: fall back to the system setting
  }
  return 'system'
}

function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('theme', theme)
  } catch {
    // ignore
  }
}

/** True while the user is typing, so letters and Space go to the field, not the mixer. */
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range'].includes(el.type)
  return !!el.closest('dialog[open]')
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e.target) || document.querySelector('dialog[open]')) return
      const a = keyToAction(e)
      if (!a) return
      // A keyboard-focused control keeps Space/Enter for itself; after a mouse click it does not.
      const el = e.target as HTMLElement
      if ((a.kind === 'cut' || a.kind === 'auto') && el !== document.body && el.matches?.(':focus-visible')) return
      e.preventDefault()
      if (a.kind === 'preview' || a.kind === 'program') send({ cmd: a.kind, slot: a.slot })
      else send({ cmd: a.kind })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
      <button type="button" className="btn btn-ghost btn-sm" onClick={dismissError}>
        {t('Dismiss')}
      </button>
    </div>
  )
}

export function App() {
  const state = useMixerState()
  const [lang, setLangState] = useState(getLang())
  const [theme, setTheme] = useState<Theme>(readTheme)
  useShortcuts()
  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return (
    <div className="app" key={lang}>
      <header className="topbar">
        <h1 className="app-title">LZ Vision Mixer</h1>
        {state && (
          <span className="meta">
            {state.format.name} · v{state.version}
          </span>
        )}
        <span className="spacer" />
        <ConnectionState />
        <label className="field field-inline">
          <span className="sr-only">{t('Language')}</span>
          <select
            value={lang}
            onChange={(e) => {
              const l = e.target.value as 'en' | 'de'
              setLang(l)
              setLangState(l)
            }}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
        <label className="field field-inline">
          <span className="sr-only">{t('Theme')}</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">{t('System theme')}</option>
            <option value="dark">{t('Dark')}</option>
            <option value="light">{t('Light')}</option>
          </select>
        </label>
      </header>

      <main className="layout">
        <div className="area-mv">
          <Multiview state={state} />
        </div>
        {state ? (
          <>
            <div className="area-trans">
              <TransitionPanel state={state} />
            </div>
            <div className="area-inputs">
              <Inputs state={state} />
            </div>
            <div className="area-overlays">
              <OverlayPanel state={state} />
            </div>
            <div className="area-outputs">
              <OutputsPanel state={state} />
            </div>
            <div className="area-audio">
              <AudioPanel state={state} />
            </div>
          </>
        ) : (
          <p className="waiting">{t('Waiting for the engine…')}</p>
        )}
      </main>
      <ErrorToast />
    </div>
  )
}
