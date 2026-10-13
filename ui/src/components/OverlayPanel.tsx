import { send } from '../client'
import { RECT_PRESETS, sameRect } from '../helpers'
import { overlayTransitionLabels, t } from '../i18n'
import { OVERLAY_TRANSITIONS, type Overlay, type OverlayTransition, type Rect, type State } from '../types'
import { NumberField, Panel } from './ui'

function OverlayRow({ o, state }: { o: Overlay; state: State }) {
  const labels = overlayTransitionLabels()
  const setRect = (r: Partial<Rect>) => send({ cmd: 'overlay', index: o.index, rect: { ...o.rect, ...r } })
  // Shown in percent, sent normalised, as the API wants.
  const pctField = (key: keyof Rect, label: string) => (
    <NumberField
      key={key}
      className="field-sm"
      label={label}
      unit="%"
      min={0}
      max={100}
      step={1}
      value={Math.round(o.rect[key] * 1000) / 10}
      onCommit={(v) => setRect({ [key]: v / 100 })}
    />
  )
  return (
    <div className="overlay-row">
      <div className="overlay-top">
        <span className="overlay-num">{o.index}</span>
        <label className="field">
          <span>{t('Input')}</span>
          <select
            value={o.slot ?? ''}
            onChange={(e) => send({ cmd: 'overlay', index: o.index, slot: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">{t('None')}</option>
            {state.slots.map((s) => (
              <option key={s.slot} value={s.slot}>
                {s.slot} {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`btn btn-onair ${o.onAir ? 'on-air' : ''}`}
          aria-pressed={o.onAir}
          disabled={o.slot == null && !o.onAir}
          title={o.slot == null ? t('Choose an input first') : undefined}
          onClick={() => send({ cmd: 'overlayOn', index: o.index, on: !o.onAir })}
        >
          {o.onAir ? t('On air') : t('Off')}
        </button>
      </div>
      <div className="overlay-mid">
        <label className="field">
          <span>{t('Transition')}</span>
          <select
            value={o.transition}
            onChange={(e) => send({ cmd: 'overlay', index: o.index, transition: e.target.value as OverlayTransition })}
          >
            {OVERLAY_TRANSITIONS.map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label={t('Duration')}
          unit="ms"
          min={0}
          max={10000}
          step={50}
          value={o.durationMs}
          onCommit={(v) => send({ cmd: 'overlay', index: o.index, durationMs: Math.round(v) })}
        />
      </div>
      <div className="overlay-rect">
        <div className="rect-preview" aria-hidden="true">
          <i
            className={o.onAir ? 'on-air' : ''}
            style={{ left: `${o.rect.x * 100}%`, top: `${o.rect.y * 100}%`, width: `${o.rect.w * 100}%`, height: `${o.rect.h * 100}%` }}
          />
        </div>
        <div className="rect-controls">
          <div className="presets" role="group" aria-label={t('Position presets')}>
            {RECT_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`chip ${sameRect(p.rect, o.rect) ? 'selected' : ''}`}
                onClick={() => send({ cmd: 'overlay', index: o.index, rect: p.rect })}
              >
                {t(p.label)}
              </button>
            ))}
          </div>
          <div className="rect-fields">
            {pctField('x', 'X')}
            {pctField('y', 'Y')}
            {pctField('w', t('W'))}
            {pctField('h', t('H'))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function OverlayPanel({ state }: { state: State }) {
  return (
    <Panel title={t('Overlays')} className="overlays">
      {state.overlays.map((o) => (
        <OverlayRow key={o.index} o={o} state={state} />
      ))}
    </Panel>
  )
}
