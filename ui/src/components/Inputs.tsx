import { useState } from 'react'
import { send, usePerf } from '../client'
import { keyForSlot, tallyOf } from '../helpers'
import { t } from '../i18n'
import { roomShort } from '../perf'
import type { Slot, State } from '../types'
import { SourceDialog } from './SourceDialog'
import { ConfirmDialog, Icon, StatusSign } from './ui'

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

/** Confirm before an input goes; says what else goes with it. */
export function RemoveInputDialog({ slot, state, onClose, onRemoved }: { slot: Slot; state: State; onClose: () => void; onRemoved?: () => void }) {
  const onAir = tallyOf(slot.slot, state) === 'program'
  const rules = state.vfa.rules.filter((r) => r.camera === slot.slot || r.source === `slot:${slot.slot}`).length
  return (
    <ConfirmDialog
      title={`${t('Remove input')} ${slot.slot}?`}
      confirmLabel={t('Remove input')}
      onConfirm={() => {
        send({ cmd: 'removeInput', slot: slot.slot })
        onRemoved?.()
      }}
      onClose={onClose}
    >
      <p>
        <b>{slot.name || t('Empty')}</b>
        {slot.spec && <span className="meta"> · {slot.spec}</span>}
      </p>
      {onAir && <p className="hint hint-error">{t('This input is on air. Removing it takes it off the programme.')}</p>}
      <p className="hint">
        {t('The number stays free; overlays, VFA rules and the wide shot that use this input are cleared.')}
        {rules > 0 && ` (${rules} ${rules === 1 ? t('rule') : t('rules')})`}
      </p>
    </ConfirmDialog>
  )
}

export function Inputs({ state }: { state: State }) {
  const perf = usePerf()
  // null: closed, 'new': add dialog, number: that input
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const editSlot = typeof editing === 'number' ? (state.slots.find((s) => s.slot === editing) ?? null) : null
  const room = perf ? roomShort(perf.forecast.moreInputs) : null
  return (
    <section className="inputs" aria-labelledby="inputs-title">
      <header className="inputs-head">
        <h2 className="overline" id="inputs-title">
          {t('Inputs')} <span className="count tabular">{state.slots.length}</span>
        </h2>
        {room && (
          <span className={`meta room ${perf?.forecast.moreInputs === 0 ? 'room-full' : ''}`} title={t('Forecast from the engine load, see Performance')}>
            {room}
          </span>
        )}
        <button type="button" className="btn btn-sm btn-soft push-end" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} />
          {t('Add input')}
        </button>
      </header>
      {state.slots.length === 0 ? (
        <p className="empty">{t('No inputs yet. Add one for each camera, file or stream.')}</p>
      ) : (
        <div className="input-grid">
          {state.slots.map((s) => {
            const tally = tallyOf(s.slot, state)
            const st = slotStatus(s)
            const key = keyForSlot(state.slots, s.slot)
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
                    aria-label={`${t('Preview')} ${s.slot}`}
                    title={key ? `${t('Preview')} (${key})` : t('Preview')}
                  >
                    {t('PVW')}
                  </button>
                  <button
                    type="button"
                    className={`btn ${state.program === s.slot ? 'selected' : ''}`}
                    aria-pressed={state.program === s.slot}
                    onClick={() => send({ cmd: 'program', slot: s.slot })}
                    aria-label={`${t('Program')} ${s.slot}`}
                    title={key ? `${t('Cut straight to program')} (Shift+${key})` : t('Cut straight to program')}
                  >
                    {t('PGM')}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {editing === 'new' && <SourceDialog slot={null} state={state} onClose={() => setEditing(null)} />}
      {editSlot && <SourceDialog slot={editSlot} state={state} onClose={() => setEditing(null)} />}
    </section>
  )
}
