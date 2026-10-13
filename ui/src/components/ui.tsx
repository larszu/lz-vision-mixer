import { useEffect, useState, type ReactNode } from 'react'

export function Panel({ title, className, children, actions }: { title: string; className?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`panel ${className ?? ''}`} aria-label={title}>
      <header className="panel-head">
        <h2 className="kicker">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  )
}

/** Square status sign; colour plus a text label so state is not colour-only. */
export function StatusSign({ tone, label }: { tone: 'ok' | 'warn' | 'error' | 'idle'; label: string }) {
  return (
    <span className={`status status-${tone}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  )
}

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
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'selected' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
