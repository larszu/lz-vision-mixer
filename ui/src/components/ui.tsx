// Shared UI layer: every panel builds on these instead of re-inventing controls.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { faderToGain, formatDb, gainToFader, meterFill, meterZone } from '../helpers'
import { t } from '../i18n'

export function Panel({ title, className, children, actions }: { title: string; className?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`panel ${className ?? ''}`} aria-label={title}>
      <header className="panel-head">
        <h2 className="overline">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  )
}

/** Square status sign; colour plus a text label so state is not colour-only. */
export function StatusSign({ tone, label, title }: { tone: 'ok' | 'warn' | 'error' | 'idle' | 'live'; label: string; title?: string }) {
  return (
    <span className={`status status-${tone}`} title={title}>
      <i aria-hidden="true" />
      {label}
    </span>
  )
}

/* ---------- Icons (Lucide geometry, 1.75 stroke, round ends) ---------- */

const ICONS = {
  monitor: ['M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M8 21h8', 'M12 17v4'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  plus: ['M5 12h14', 'M12 5v14'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  keyboard: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M6 9h.01', 'M10 9h.01', 'M14 9h.01', 'M18 9h.01', 'M8 13h.01', 'M12 13h.01', 'M16 13h.01', 'M7 16h10'],
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/* ---------- Fields ---------- */

/**
 * Number input that keeps a local draft while typing and only commits on
 * blur or Enter, so the engine is not flooded with half-typed values.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step,
  label,
  unit,
  className,
}: {
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  unit?: string
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])
  const commit = () => {
    setEditing(false)
    let v = Number(draft.replace(',', '.'))
    if (!Number.isFinite(v)) return setDraft(String(value))
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    setDraft(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(String(value))
            setEditing(false)
          }
        }}
      />
      {unit && <em>{unit}</em>}
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div className={`segmented ${className ?? ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.title}
          title={o.title}
          className={o.value === value ? 'selected' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** On/off switch (role="switch"); the label says the state in words as well. */
export function Switch({ on, onChange, label, className, title }: { on: boolean; onChange: (on: boolean) => void; label: ReactNode; className?: string; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''} ${className ?? ''}`} onClick={() => onChange(!on)} title={title}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  )
}

/** Calls fn at most once per animation frame with the latest value. */
export function useFrameQueue<T>(fn: (v: T) => void) {
  const pending = useRef<{ v: T } | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  return (v: T) => {
    if (pending.current == null)
      requestAnimationFrame(() => {
        if (pending.current) fnRef.current(pending.current.v)
        pending.current = null
      })
    pending.current = { v }
  }
}

/* ---------- Audio ---------- */

/** Peak meter; vertical for strips, horizontal for rows. One value per channel. */
export function Meter({ peaks, horizontal }: { peaks: number[] | undefined; horizontal?: boolean }) {
  const list = peaks && peaks.length ? peaks : [-90]
  return (
    <div className={`meter ${horizontal ? 'meter-h' : ''}`} aria-hidden="true">
      {list.map((db, i) => (
        <div key={i} className="meter-ch">
          <div
            className={`meter-fill zone-${meterZone(db)}`}
            style={horizontal ? { width: `${meterFill(db) * 100}%` } : { height: `${meterFill(db) * 100}%` }}
          />
        </div>
      ))}
    </div>
  )
}

/** Fader in dB travel; volume sends are coalesced per frame while dragging. */
export function Fader({ volume, label, onVolume, horizontal }: { volume: number; label: string; onVolume: (v: number) => void; horizontal?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null)
  const queue = useFrameQueue(onVolume)
  const pos = drag ?? gainToFader(volume)
  return (
    <input
      type="range"
      className={`fader ${horizontal ? 'fader-h' : ''}`}
      min={0}
      max={1000}
      value={Math.round(pos * 1000)}
      aria-label={label}
      aria-valuetext={`${formatDb(faderToGain(pos))} dB`}
      title={t('Double-click for 0 dB')}
      onChange={(e) => {
        const p = Number(e.target.value) / 1000
        setDrag(p)
        queue(faderToGain(p))
      }}
      onPointerUp={() => setDrag(null)}
      onBlur={() => setDrag(null)}
      onDoubleClick={() => {
        setDrag(null)
        onVolume(1)
      }}
    />
  )
}

/* ---------- Tabs ---------- */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; badge?: ReactNode }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const move = (dir: number) => {
    const i = tabs.findIndex((x) => x.id === value)
    const next = tabs[(i + dir + tabs.length) % tabs.length]
    onChange(next.id)
    refs.current[next.id]?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[tab.id] = el
          }}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`tabpanel-${tab.id}`}
          aria-selected={tab.id === value}
          tabIndex={tab.id === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') move(1)
            else if (e.key === 'ArrowLeft') move(-1)
            else return
            e.preventDefault()
          }}
        >
          {tab.label}
          {tab.badge}
        </button>
      ))}
    </div>
  )
}
