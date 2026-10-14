import { useRef, useState } from 'react'
import { pickPath, send } from '../client'
import { OUTPUT_PRESETS, audioOutputSpec, needMet, specNeed } from '../helpers'
import { needLabel, t } from '../i18n'
import type { Output, State } from '../types'
import { Icon, Panel, StatusSign } from './ui'

function outputStatus(o: Output) {
  if (o.status === 'running') return { tone: 'ok' as const, label: t('Running') }
  if (o.status === 'starting') return { tone: 'warn' as const, label: t('Starting') }
  return { tone: 'error' as const, label: t('Error') }
}

export function OutputsPanel({ state }: { state: State }) {
  const [spec, setSpec] = useState('')
  const [picking, setPicking] = useState(false)
  const recording = spec.trim().startsWith('record:')
  const browse = async () => {
    setPicking(true)
    const r = await pickPath('save')
    setPicking(false)
    if ('path' in r) setSpec(`record:${r.path}`)
    input.current?.focus()
  }
  const input = useRef<HTMLInputElement>(null)
  const caps = state.capabilities
  const need = specNeed(spec)
  const add = () => {
    const s = spec.trim()
    if (!s) return
    send({ cmd: 'addOutput', spec: s })
    setSpec('')
  }
  return (
    <Panel title={t('Outputs')} className="outputs">
      {state.outputs.length === 0 ? (
        <p className="empty">{t('No outputs yet. Add one below.')}</p>
      ) : (
        <ul className="output-list">
          {state.outputs.map((o) => {
            const st = outputStatus(o)
            return (
              <li key={o.id}>
                <StatusSign tone={st.tone} label={st.label} />
                <span className="output-spec" title={o.spec}>
                  {o.spec}
                  {o.error && <small className="output-error">{o.error}</small>}
                </span>
                <button type="button" className="btn btn-ghost btn-danger" onClick={() => send({ cmd: 'removeOutput', id: o.id })}>
                  {t('Remove')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <form
        className="output-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label className="field field-wide">
          <span>{t('New output')}</span>
          <input
            ref={input}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="srt://0.0.0.0:9100?mode=listener"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {recording && (
          <button type="button" className="btn" disabled={picking} onClick={browse} title={t('Choose where to record. Opens on the computer running the engine.')}>
            <Icon name="folder" size={16} />
            {picking ? t('Waiting for the dialog…') : t('Browse…')}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!spec.trim()}>
          {t('Add output')}
        </button>
      </form>
      {need && !needMet(need, caps) && <p className="hint hint-warn">{needLabel(need)}</p>}
      <div className="presets" role="group" aria-label={t('Presets')}>
        {OUTPUT_PRESETS.map((p) => {
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
                input.current?.focus()
              }}
            >
              {t(p.label)}
            </button>
          )
        })}
      </div>
      <div className="audio-outs">
        <div className="audio-outs-head">
          <h3 className="section-title">{t('Audio interface')}</h3>
          <button type="button" className="btn btn-sm btn-ghost push-end" onClick={() => send({ cmd: 'refreshDevices' })} title={t('Look for audio devices again')}>
            <Icon name="refresh" size={16} />
            {t('Refresh devices')}
          </button>
        </div>
        <p className="hint">{t('Programme audio to an interface, headphones or a virtual device.')}</p>
        {state.audioOutputs.length === 0 ? (
          <p className="hint">{t('No audio outputs found.')}</p>
        ) : (
          <div className="presets" role="group" aria-label={t('Audio interface')}>
            {state.audioOutputs.map((d) => {
              const p = audioOutputSpec(d.id)
              const used = state.outputs.some((o) => o.spec === p)
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`chip ${spec === p ? 'selected' : ''}`}
                  title={used ? `${p} (${t('already an output')})` : p}
                  onClick={() => {
                    setSpec(p)
                    input.current?.focus()
                  }}
                >
                  {d.name}
                  {used && <span className="chip-note">· {t('in use')}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Panel>
  )
}
