import { useEffect, useRef, useState } from 'react'
import { send } from '../client'
import { SOURCE_PRESETS, needMet, specNeed } from '../helpers'
import { needLabel, t } from '../i18n'
import type { Capabilities, Slot } from '../types'

export function SourceDialog({ slot, caps, onClose }: { slot: Slot; caps: Capabilities; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const specRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(slot.name)
  const [spec, setSpec] = useState(slot.spec ?? '')

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const need = specNeed(spec)
  const missing = need && !needMet(need, caps)

  const apply = () => {
    const s = spec.trim()
    const n = name.trim()
    if (s && s !== slot.spec) send({ cmd: 'setInput', slot: slot.slot, spec: s, ...(n ? { name: n } : {}) })
    else if (n && n !== slot.name) send({ cmd: 'renameInput', slot: slot.slot, name: n })
    onClose()
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="src-title">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <header className="panel-head">
          <h2 className="kicker" id="src-title">
            {t('Input')} {slot.slot}
          </h2>
        </header>
        <label className="field field-wide">
          <span>{t('Name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label className="field field-wide">
          <span>{t('Source')}</span>
          <input ref={specRef} value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="test:smpte" autoComplete="off" spellCheck={false} />
        </label>
        {missing && <p className="hint hint-warn">{needLabel(need)}</p>}
        <div className="presets" role="group" aria-label={t('Presets')}>
          {SOURCE_PRESETS.map((p) => {
            const ok = needMet(p.need, caps)
            return (
              <button
                key={p.spec}
                type="button"
                className={`chip ${spec === p.spec ? 'selected' : ''}`}
                disabled={!ok}
                title={ok ? p.spec : needLabel(p.need)}
                onClick={() => {
                  setSpec(p.spec)
                  if (p.partial) requestAnimationFrame(() => specRef.current?.focus())
                }}
              >
                {t(p.label)}
              </button>
            )
          })}
        </div>
        <footer className="dialog-actions">
          {slot.spec && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                send({ cmd: 'clearInput', slot: slot.slot })
                onClose()
              }}
            >
              {t('Clear input')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('Apply')}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
