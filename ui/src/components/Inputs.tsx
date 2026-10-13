import { useState } from 'react'
import { send } from '../client'
import { tallyOf } from '../helpers'
import { t } from '../i18n'
import type { Slot, State } from '../types'
import { SourceDialog } from './SourceDialog'
import { StatusSign } from './ui'

export function slotStatus(s: Slot) {
  switch (s.status) {
    case 'running':
      return { tone: 'ok' as const, label: t('Running') }
    case 'starting':
      return { tone: 'warn' as const, label: t('Starting') }
    case 'error':
      return { tone: 'error' as const, label: t('Error') }
    default:
      return { tone: 'idle' as const, label: t('Empty') }
  }
}

export function Inputs({ state }: { state: State }) {
  const [editing, setEditing] = useState<number | null>(null)
  const editSlot = state.slots.find((s) => s.slot === editing) ?? null
  return (
    <section className="inputs" aria-label={t('Inputs')}>
      {state.slots.map((s) => {
        const tally = tallyOf(s.slot, state)
        const st = slotStatus(s)
        return (
          <article key={s.slot} className={`input-card ${tally ? `tally-${tally}` : ''}`}>
            <button type="button" className="input-name" onClick={() => setEditing(s.slot)} title={t('Edit source')}>
              <span className="input-num">{s.slot}</span>
              <span className="input-title">{s.name || t('Empty')}</span>
            </button>
            <div className="input-meta">
              <StatusSign tone={st.tone} label={st.label} />
              <span className="input-spec" title={s.error ?? s.spec ?? ''}>
                {s.status === 'error' && s.error ? s.error : (s.spec ?? '')}
              </span>
            </div>
            <div className="input-actions">
              <button
                type="button"
                className={`btn ${state.preview === s.slot ? 'selected' : ''}`}
                aria-pressed={state.preview === s.slot}
                onClick={() => send({ cmd: 'preview', slot: s.slot })}
              >
                {t('Preview')}
              </button>
              <button
                type="button"
                className={`btn ${state.program === s.slot ? 'selected' : ''}`}
                aria-pressed={state.program === s.slot}
                onClick={() => send({ cmd: 'program', slot: s.slot })}
                title={t('Cut straight to program')}
              >
                {t('Program')}
              </button>
            </div>
          </article>
        )
      })}
      {editSlot && <SourceDialog slot={editSlot} caps={state.capabilities} onClose={() => setEditing(null)} />}
    </section>
  )
}
