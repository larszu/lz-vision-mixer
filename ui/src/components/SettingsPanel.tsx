import { useEffect, useState } from 'react'
import { send } from '../client'
import { oscProblemLabel, t } from '../i18n'
import { OSC_FEEDBACK, OSC_RECEIVE, oscTargetProblem, type OscEntry } from '../osc'
import type { State } from '../types'
import { Icon, Panel } from './ui'

function TargetRow({ value, index, targets }: { value: string; index: number; targets: string[] }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const others = targets.filter((_, i) => i !== index)
  const problem = draft.trim() === value ? null : oscTargetProblem(draft, others)
  const commit = () => {
    const v = draft.trim()
    if (v === value || problem) return
    send({ cmd: 'setOscTargets', targets: targets.map((x, i) => (i === index ? v : x)) })
  }
  return (
    <li className="osc-target">
      <label className="field-stack">
        <span className="sr-only">
          {t('Feedback target')} {index + 1}
        </span>
        <input
          value={draft}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!problem}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(value)
          }}
        />
      </label>
      <button
        type="button"
        className="btn btn-icon btn-ghost"
        aria-label={`${t('Remove')} ${value}`}
        title={t('Remove')}
        onClick={() => send({ cmd: 'setOscTargets', targets: targets.filter((_, i) => i !== index) })}
      >
        <Icon name="x" size={16} />
      </button>
      {problem && <span className="field-error">{oscProblemLabel(problem)}</span>}
    </li>
  )
}

function CheatTable({ entries, caption }: { entries: OscEntry[]; caption: string }) {
  return (
    <table className="osc-table">
      <caption>{caption}</caption>
      <tbody>
        {entries.map((e) => (
          <tr key={e.address}>
            <th scope="row">
              <code>{e.address}</code>
            </th>
            <td>{t(e.hint)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SettingsPanel({ state }: { state: State }) {
  const { listen, targets } = state.osc
  const [draft, setDraft] = useState('')
  const [tried, setTried] = useState(false)
  const problem = oscTargetProblem(draft, targets)
  const add = () => {
    setTried(true)
    if (problem) return
    send({ cmd: 'setOscTargets', targets: [...targets, draft.trim()] })
    setDraft('')
    setTried(false)
  }
  const showProblem = problem && (tried || (draft.trim() !== '' && problem !== 'format'))

  return (
    <Panel title={t('Settings')} className="settings">
      <h3 className="section-title section-first">OSC</h3>
      <dl className="osc-facts">
        <div>
          <dt>{t('Receives on')}</dt>
          <dd>{listen ? <code>udp://{listen}</code> : <span className="meta">{t('Off')}</span>}</dd>
        </div>
      </dl>
      <p className="hint">{t('The engine sets this at start (--osc host:port, or off).')}</p>

      <h3 className="section-title">{t('Feedback targets')}</h3>
      <p className="hint">{t('Tally, programme, preview and more go to these addresses when they change.')}</p>
      {targets.length > 0 && (
        <ul className="osc-targets">
          {targets.map((x, i) => (
            <TargetRow key={`${i}-${x}`} value={x} index={i} targets={targets} />
          ))}
        </ul>
      )}
      <form
        className="output-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label className="field-wide">
          <span>{t('New target')}</span>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setTried(false)
            }}
            placeholder="192.168.1.20:9000"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!showProblem}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
          {t('Add')}
        </button>
      </form>
      {showProblem && <p className="field-error">{oscProblemLabel(problem)}</p>}

      <details className="osc-cheat">
        <summary>
          <Icon name="chevron" size={16} />
          {t('OSC addresses')}
        </summary>
        <p className="hint">{t('Numbers can be in the path or the first argument.')}</p>
        <CheatTable entries={OSC_RECEIVE} caption={t('The mixer receives')} />
        <CheatTable entries={OSC_FEEDBACK} caption={t('The mixer sends')} />
      </details>
    </Panel>
  )
}
