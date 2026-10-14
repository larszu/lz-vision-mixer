import { useState } from 'react'
import { send, useLevels } from '../client'
import { tallyOf } from '../helpers'
import { getLang, t } from '../i18n'
import type { State, Vfa, VfaRule, VfaSettings } from '../types'
import { VFA_PRESETS, VFA_RANGES, clampToRange, formatVfaValue, nextFreeSource, parseSource, presetMatches, speechFill, type VfaRange } from '../vfa'
import { micLabel } from './MicsPanel'
import { Icon, Panel, Segmented, Switch, useFrameQueue } from './ui'

/** "Mic 2 · Anna" or "Input 3 · Cam" for a VFA source key. */
export function sourceLabel(key: string | null, state: State): string {
  if (key == null) return t('Nobody')
  if (key === 'wide') return t('Wide shot')
  const src = parseSource(key)
  if (!src) return key
  if (src.kind === 'mic') return micLabel(state.mics.find((m) => m.mic === src.n), src.n)
  const slot = state.slots.find((s) => s.slot === src.n)
  return `${t('Input')} ${src.n}${slot?.name ? ` · ${slot.name}` : ''} (${t('audio')})`
}

const slotLabel = (state: State, n: number | null) => {
  if (n == null) return t('None')
  const s = state.slots.find((x) => x.slot === n)
  return `${n} ${s?.name || t('Empty')}`
}

/** VFA on/off; also used in the transition column so the operator always sees it. */
export function VfaSwitch({ vfa, compact }: { vfa: Vfa; compact?: boolean }) {
  return (
    <Switch
      className={compact ? 'switch-compact' : 'switch-big'}
      on={vfa.enabled}
      onChange={(enabled) => send({ cmd: 'setVfa', enabled })}
      title={t('Video follows audio (V)')}
      label={
        compact ? (
          <>
            {t('VFA')} <b>{vfa.enabled ? t('On') : t('Off')}</b>
          </>
        ) : (
          <>
            <span className="switch-title">{t('Video follows audio')}</span>
            <b>{vfa.enabled ? t('On: cuts to whoever speaks') : t('Off: manual cutting')}</b>
          </>
        )
      }
    />
  )
}

function SpeechBar({ db, threshold, speaking }: { db: number | undefined; threshold: number; speaking: boolean }) {
  const above = db != null && db >= threshold
  return (
    <div className={`speech ${speaking ? 'speaking' : above ? 'above' : ''}`} aria-hidden="true">
      <div className="speech-fill" style={{ width: `${speechFill(db) * 100}%` }} />
      <div className="speech-threshold" style={{ left: `${speechFill(threshold) * 100}%` }} />
    </div>
  )
}

function RuleRow({ rule, index, state, db }: { rule: VfaRule; index: number; state: State; db: number | undefined }) {
  const vfa = state.vfa
  const speaking = vfa.speaking === rule.source
  const tally = tallyOf(rule.camera, state)
  const setRule = (r: Partial<VfaRule>) => send({ cmd: 'setVfa', rules: vfa.rules.map((x, i) => (i === index ? { ...x, ...r } : x)) })
  const sources = [
    ...state.mics.map((m) => ({ key: `mic:${m.mic}`, label: micLabel(m, m.mic) })),
    ...state.slots.map((s) => ({ key: `slot:${s.slot}`, label: `${t('Input')} ${s.slot}${s.name ? ` · ${s.name}` : ''} (${t('audio')})` })),
  ]
  return (
    <li className={`rule ${speaking ? 'speaking' : ''}`}>
      <label className="field-stack">
        <span>{t('Audio source')}</span>
        <select value={rule.source} onChange={(e) => setRule({ source: e.target.value })}>
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <span className="rule-arrow" aria-hidden="true">
        →
      </span>
      <label className="field-stack">
        <span>{t('Camera')}</span>
        <select className={tally ? `tally-${tally}` : ''} value={rule.camera} onChange={(e) => setRule({ camera: Number(e.target.value) })}>
          {state.slots.map((s) => (
            <option key={s.slot} value={s.slot}>
              {slotLabel(state, s.slot)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-icon btn-ghost"
        aria-label={`${t('Remove rule')} ${index + 1}`}
        title={t('Remove rule')}
        onClick={() => send({ cmd: 'setVfa', rules: vfa.rules.filter((_, i) => i !== index) })}
      >
        <Icon name="x" size={16} />
      </button>
      <div className="rule-live">
        <SpeechBar db={db} threshold={vfa.thresholdDb} speaking={speaking} />
        <span className="rule-db">{db == null || db <= -90 ? '–' : `${Math.round(db)} dB`}</span>
        <span className="rule-state" title={speaking && !(db != null && db >= vfa.thresholdDb) ? t('Still the chosen speaker during a pause') : undefined}>
          {speaking ? (db != null && db >= vfa.thresholdDb ? t('Speaking') : t('Holding')) : ''}
        </span>
      </div>
    </li>
  )
}

function RangeRow({ r, value }: { r: VfaRange; value: number }) {
  const [drag, setDrag] = useState<number | null>(null)
  const queue = useFrameQueue((v: number) => send({ cmd: 'setVfa', [r.key]: v } as { cmd: 'setVfa' } & Partial<VfaSettings>))
  const shown = drag ?? value
  return (
    <label className="range-row" title={t(r.hint)}>
      <span className="range-label">{t(r.label)}</span>
      <input
        type="range"
        min={r.min}
        max={r.max}
        step={r.step}
        value={shown}
        aria-valuetext={formatVfaValue(r, shown, getLang(), t('Off'))}
        onChange={(e) => {
          const v = clampToRange(r, Number(e.target.value))
          setDrag(v)
          queue(v)
        }}
        onPointerUp={() => setDrag(null)}
        onKeyUp={() => setDrag(null)}
        onBlur={() => setDrag(null)}
      />
      <output className="range-value">{formatVfaValue(r, shown, getLang(), t('Off'))}</output>
    </label>
  )
}

export function VfaPanel({ state }: { state: State }) {
  const vfa = state.vfa
  const levels = useLevels()
  const micsInUse = state.mics.filter((m) => m.device).map((m) => m.mic)
  const speakingRule = vfa.rules.find((r) => r.source === vfa.speaking)
  const now =
    vfa.speaking === 'wide'
      ? `${t('Wide shot')} → ${slotLabel(state, vfa.wideSlot)}`
      : speakingRule
        ? `${sourceLabel(vfa.speaking, state)} → ${slotLabel(state, speakingRule.camera)}`
        : t('Nobody is speaking')

  return (
    <Panel title={t('Video follows audio')} className="vfa">
      <div className="vfa-head">
        <VfaSwitch vfa={vfa} />
        <p className="vfa-now" aria-live="polite">
          <span className="meta">{t('Now')}</span> {now}
        </p>
      </div>

      <h3 className="section-title">{t('Who is on which camera')}</h3>
      {vfa.rules.length === 0 ? (
        <p className="hint">{t('No rules yet. Add one per speaker: their mic and the camera that shows them.')}</p>
      ) : (
        <ul className="rules">
          {vfa.rules.map((r, i) => (
            <RuleRow key={i} rule={r} index={i} state={state} db={levels?.speech[r.source]} />
          ))}
        </ul>
      )}
      <div className="vfa-row">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            send({
              cmd: 'setVfa',
              rules: [...vfa.rules, { source: nextFreeSource(vfa.rules.map((r) => r.source), micsInUse), camera: state.preview ?? 1 }],
            })
          }
        >
          <Icon name="plus" size={16} />
          {t('Add rule')}
        </button>
        <label className="field push-end">
          <span>{t('Wide shot')}</span>
          <select value={vfa.wideSlot ?? ''} onChange={(e) => send({ cmd: 'setVfa', wideSlot: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">{t('None')}</option>
            {state.slots.map((s) => (
              <option key={s.slot} value={s.slot}>
                {slotLabel(state, s.slot)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3 className="section-title">{t('Timing and levels')}</h3>
      <div className="presets" role="group" aria-label={t('Presets')}>
        {VFA_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip ${presetMatches(p, vfa) ? 'selected' : ''}`}
            aria-pressed={presetMatches(p, vfa)}
            onClick={() => send({ cmd: 'setVfa', ...p.settings })}
          >
            {t(p.label)}
          </button>
        ))}
      </div>
      <div className="ranges">
        {VFA_RANGES.map((r) => (
          <RangeRow key={r.key} r={r} value={vfa[r.key]} />
        ))}
      </div>
      <div className="vfa-row">
        <span className="meta">{t('Switch with')}</span>
        <Segmented
          className="segmented-auto"
          label={t('Switch with')}
          value={vfa.transition}
          onChange={(transition) => send({ cmd: 'setVfa', transition })}
          options={[
            { value: 'cut', label: t('Cut') },
            { value: 'auto', label: t('Selected transition') },
          ]}
        />
      </div>
    </Panel>
  )
}
