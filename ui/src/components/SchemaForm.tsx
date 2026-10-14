// Form generated from an OGraf/GDD JSON schema (see schemaForm.ts for the model).
import { useState } from 'react'
import { t } from '../i18n'
import { coerce, newItem, toHexColor, type FieldModel } from '../schemaForm'
import { Icon } from './ui'

type Data = Record<string, unknown>

function SimpleInput({ f, value, onChange, label, id }: { f: FieldModel; value: unknown; onChange: (v: unknown) => void; label: string; id?: string }) {
  switch (f.kind) {
    case 'boolean':
      return <input id={id} type="checkbox" checked={!!value} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    case 'enum':
      return (
        <select id={id} aria-label={label} value={String(value ?? '')} onChange={(e) => onChange(f.options!.find((o) => String(o.value) === e.target.value)?.value ?? e.target.value)}>
          {f.options!.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'color': {
      const hex = toHexColor(value)
      const alpha = typeof value === 'string' && /^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : ''
      return (
        <span className="color-field">
          <input id={id} type="color" aria-label={label} value={hex} onChange={(e) => onChange(e.target.value + alpha)} />
          <code>{typeof value === 'string' ? value : hex}</code>
        </span>
      )
    }
    case 'number':
      return <NumberInput f={f} value={value} onChange={onChange} label={label} id={id} />
    case 'text':
      return <textarea id={id} aria-label={label} rows={2} value={String(value ?? '')} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />
    default:
      return <input id={id} aria-label={label} value={String(value ?? '')} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
  }
}

function NumberInput({ f, value, onChange, label, id }: { f: FieldModel; value: unknown; onChange: (v: unknown) => void; label: string; id?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      aria-label={label}
      min={f.min}
      max={f.max}
      step={f.step ?? 'any'}
      value={draft ?? String(value ?? '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null) onChange(coerce(f, draft))
        setDraft(null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function JsonInput({ value, onChange, label, id }: { value: unknown; onChange: (v: unknown) => void; label: string; id?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  return (
    <>
      <textarea
        id={id}
        aria-label={label}
        aria-invalid={bad}
        rows={3}
        className="mono"
        spellCheck={false}
        value={draft ?? JSON.stringify(value ?? null, null, 1)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft == null) return
          try {
            onChange(JSON.parse(draft))
            setBad(false)
            setDraft(null)
          } catch {
            setBad(true)
          }
        }}
      />
      {bad && <small className="field-error">{t('Not valid JSON; the last valid value is kept.')}</small>}
    </>
  )
}

function ArrayInput({ f, value, onChange }: { f: FieldModel; value: unknown; onChange: (v: unknown) => void }) {
  const list = Array.isArray(value) ? value : []
  const item = f.item!
  const canAdd = f.maxItems === undefined || list.length < f.maxItems
  const canRemove = f.minItems === undefined || list.length > f.minItems
  const set = (i: number, v: unknown) => onChange(list.map((x, j) => (j === i ? v : x)))
  return (
    <div className="array-field">
      {list.map((v, i) => (
        <div key={i} className="array-item">
          <span className="array-num">{i + 1}</span>
          {item.kind === 'object' ? (
            <div className="array-object">
              {item.fields!.map((sub) => (
                <label key={sub.key} className="field-stack">
                  <span>{sub.label}</span>
                  <SimpleInput
                    f={sub}
                    label={`${f.label} ${i + 1} ${sub.label}`}
                    value={(v as Data | null)?.[sub.key]}
                    onChange={(x) => set(i, { ...(v as Data), [sub.key]: x })}
                  />
                </label>
              ))}
            </div>
          ) : (
            <SimpleInput f={item} label={`${f.label} ${i + 1}`} value={v} onChange={(x) => set(i, x)} />
          )}
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            disabled={!canRemove}
            aria-label={`${t('Remove')} ${f.label} ${i + 1}`}
            title={t('Remove')}
            onClick={() => onChange(list.filter((_, j) => j !== i))}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" disabled={!canAdd} onClick={() => onChange([...list, newItem(item)])}>
        <Icon name="plus" size={16} />
        {t('Add')}
      </button>
    </div>
  )
}

function FieldRow({ f, value, onChange, idPrefix }: { f: FieldModel; value: unknown; onChange: (v: unknown) => void; idPrefix: string }) {
  const id = `${idPrefix}-${f.key}`
  if (f.kind === 'object')
    return (
      <fieldset className="form-group">
        <legend>{f.label}</legend>
        <SchemaFields fields={f.fields!} data={(value as Data) ?? {}} onChange={onChange as (d: Data) => void} idPrefix={id} />
      </fieldset>
    )
  const wide = f.kind === 'array' || f.kind === 'json' || f.kind === 'text'
  return (
    <div className={`form-row ${wide ? 'form-row-wide' : ''} ${f.kind === 'boolean' ? 'form-row-check' : ''}`}>
      <label htmlFor={f.kind === 'array' ? undefined : id} title={f.description}>
        {f.label}
      </label>
      {f.kind === 'array' ? (
        <ArrayInput f={f} value={value} onChange={onChange} />
      ) : f.kind === 'json' ? (
        <JsonInput id={id} value={value} onChange={onChange} label={f.label} />
      ) : (
        <SimpleInput id={id} f={f} value={value} onChange={onChange} label={f.label} />
      )}
      {f.description && wide && <small className="form-hint">{f.description}</small>}
    </div>
  )
}

export function SchemaFields({ fields, data, onChange, idPrefix }: { fields: FieldModel[]; data: Data; onChange: (d: Data) => void; idPrefix: string }) {
  return (
    <div className="schema-form">
      {fields.map((f) => (
        <FieldRow key={f.key} f={f} idPrefix={idPrefix} value={data[f.key]} onChange={(v) => onChange({ ...data, [f.key]: v })} />
      ))}
    </div>
  )
}
