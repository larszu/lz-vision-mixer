import { useRef, useState } from 'react'
import { send } from '../client'
import { EASE_FAMILIES, ease, type Easing } from '../easing'
import { clamp01 } from '../helpers'
import { kindLabels, t } from '../i18n'
import { TRANSITION_KINDS, type State, type TransitionKind } from '../types'
import { NumberField, Panel, Segmented } from './ui'

export function CurvePreview({ easing }: { easing: Easing }) {
  const W = 96
  const H = 56
  const PAD = 12
  const pts = Array.from({ length: 49 }, (_, i) => {
    const x = i / 48
    const y = ease(easing, x)
    return `${(x * W).toFixed(1)},${(PAD + (1 - y) * (H - 2 * PAD)).toFixed(1)}`
  })
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1="0" x2={W} y1={H - PAD} y2={H - PAD} className="curve-base" />
      <line x1="0" x2={W} y1={PAD} y2={PAD} className="curve-base" />
      <polyline points={pts.join(' ')} className="curve-line" />
    </svg>
  )
}

/**
 * Vertical T-bar, top = 0, bottom = 1. While dragging the local value wins;
 * otherwise it follows state.tbar, which also shows auto transitions running.
 * Sends are coalesced to one per animation frame.
 */
function TBar({ value }: { value: number }) {
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const pending = useRef<number | null>(null)

  const flush = () => {
    if (pending.current == null) return
    send({ cmd: 'tbar', value: pending.current })
    pending.current = null
  }
  const queue = (v: number) => {
    if (pending.current == null) requestAnimationFrame(flush)
    pending.current = v
  }
  const fromPointer = (clientY: number) => {
    const r = track.current!.getBoundingClientRect()
    return clamp01((clientY - r.top) / r.height)
  }

  const shown = drag ?? value
  return (
    <div className="tbar">
      <div
        ref={track}
        className="tbar-track"
        role="slider"
        tabIndex={0}
        aria-label={t('T-bar')}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const v = fromPointer(e.clientY)
          setDrag(v)
          queue(v)
        }}
        onPointerMove={(e) => {
          if (drag == null) return
          const v = fromPointer(e.clientY)
          setDrag(v)
          queue(v)
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02
          if (e.key === 'ArrowDown') send({ cmd: 'tbar', value: clamp01(value + step) })
          else if (e.key === 'ArrowUp') send({ cmd: 'tbar', value: clamp01(value - step) })
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className="tbar-fill" style={{ height: `${shown * 100}%` }} />
        <div className="tbar-handle" style={{ top: `${shown * 100}%` }} />
      </div>
      <span className="tbar-value">{Math.round(shown * 100)}%</span>
    </div>
  )
}

export function TransitionPanel({ state }: { state: State }) {
  const tr = state.transition
  const labels = kindLabels()
  const setEasing = (e: Partial<Easing>) => send({ cmd: 'setTransition', easing: { ...tr.easing, ...e } })
  return (
    <Panel title={t('Transition')} className="transition">
      <div className="transition-body">
        <div className="transition-main">
          <div className="take">
            <button type="button" className="btn btn-take" onClick={() => send({ cmd: 'cut' })} title={t('Cut (Space)')}>
              {t('Cut')}
            </button>
            <button
              type="button"
              className={`btn btn-take btn-auto ${state.inTransition ? 'running' : ''}`}
              onClick={() => send({ cmd: 'auto' })}
              title={t('Auto (Enter)')}
            >
              {t('Auto')}
            </button>
          </div>
          <label className="field">
            <span>{t('Type')}</span>
            <select value={tr.kind} onChange={(e) => send({ cmd: 'setTransition', kind: e.target.value as TransitionKind })}>
              {TRANSITION_KINDS.map((k) => (
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
            value={tr.durationMs}
            onCommit={(v) => send({ cmd: 'setTransition', durationMs: Math.round(v) })}
          />
          <div className="easing">
            <label className="field">
              <span>{t('Curve')}</span>
              <select value={tr.easing.family} onChange={(e) => setEasing({ family: e.target.value as Easing['family'] })}>
                {EASE_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <CurvePreview easing={tr.easing} />
          </div>
          <Segmented
            label={t('Curve direction')}
            value={tr.easing.direction}
            onChange={(direction) => setEasing({ direction })}
            options={[
              { value: 'in', label: t('In') },
              { value: 'out', label: t('Out') },
              { value: 'inOut', label: t('In and out') },
            ]}
          />
          <button
            type="button"
            className={`btn btn-ftb ${state.ftb ? 'on-air' : ''}`}
            aria-pressed={state.ftb}
            onClick={() => send({ cmd: 'ftb' })}
            title={t('Fade to black (F)')}
          >
            {t('FTB')}
          </button>
        </div>
        <TBar value={state.tbar} />
      </div>
    </Panel>
  )
}
