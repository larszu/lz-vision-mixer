import { useEffect, useRef, useState } from 'react'
import { usePerf } from '../client'
import { t } from '../i18n'
import { CPU_BUDGET, basisLabel, basisSentence, costSentence, forecastSentence, fps, gb, num, perfTone, type LoadTone } from '../perf'
import type { Perf } from '../types'
import { Icon, StatusSign } from './ui'

function toneLabel(p: Perf, tone: LoadTone): string {
  if (tone === 'error') return t('Overloaded: frames are dropped')
  if (tone === 'warn') return p.outputFps < p.nominalFps * 0.99 ? t('Output dips below the frame rate') : t('Machine busy')
  return t('Running smoothly')
}

const pct = (v: number) => `${Math.min(100, Math.max(0, v))}%`

function PerfPanel({ p, onClose }: { p: Perf; onClose: () => void }) {
  const tone = perfTone(p)
  const f = p.forecast
  const other = Math.max(0, p.systemCpu - p.cpu)
  const memOther = Math.max(0, p.memoryUsedMb - p.processMemoryMb)
  return (
    <div className="perf-pop" id="perf-pop" role="dialog" aria-labelledby="perf-title">
      <header className="perf-head">
        <h2 className="dialog-title" id="perf-title">
          {t('Performance')}
        </h2>
        <button type="button" className="btn btn-icon btn-ghost push-end" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
          <Icon name="x" size={16} />
        </button>
      </header>
      <p className={`perf-state perf-${tone}`}>
        <StatusSign tone={tone} label={toneLabel(p, tone)} />
      </p>

      <div className="perf-meter">
        <div className="perf-meter-head">
          <span>{t('CPU')}</span>
          <b className="tabular">
            {num(p.systemCpu)} % <span className="meta">{t('whole machine')}</span>
          </b>
        </div>
        <div className="bar" aria-hidden="true">
          <i className="bar-engine" style={{ width: pct(p.cpu) }} />
          <i className="bar-other" style={{ left: pct(p.cpu), width: pct(other) }} />
          <i className="bar-limit" style={{ left: pct(CPU_BUDGET) }} />
        </div>
        <div className="bar-legend meta">
          <span>
            <i className="key key-engine" /> {t('Mixer')} <b className="tabular">{num(p.cpu)} %</b>
          </span>
          <span>
            <i className="key key-other" /> {t('Other programs')} <b className="tabular">{num(other)} %</b>
          </span>
          <span>
            <i className="key key-limit" /> {t('Limit')} {CPU_BUDGET} %
          </span>
        </div>
      </div>

      <div className="perf-meter">
        <div className="perf-meter-head">
          <span>{t('Memory')}</span>
          <b className="tabular">
            {gb(p.memoryUsedMb)} / {gb(p.memoryTotalMb)} GB
          </b>
        </div>
        <div className="bar" aria-hidden="true">
          <i className="bar-engine" style={{ width: pct((p.processMemoryMb / p.memoryTotalMb) * 100) }} />
          <i className="bar-other" style={{ left: pct((p.processMemoryMb / p.memoryTotalMb) * 100), width: pct((memOther / p.memoryTotalMb) * 100) }} />
        </div>
        <div className="bar-legend meta">
          <span>
            <i className="key key-engine" /> {t('Mixer')} <b className="tabular">{gb(p.processMemoryMb)} GB</b>
          </span>
          <span>
            <i className="key key-other" /> {t('Other programs')} <b className="tabular">{gb(memOther)} GB</b>
          </span>
        </div>
      </div>

      <dl className="perf-stats">
        <div>
          <dt>{t('Output')}</dt>
          <dd className="tabular">
            {fps(p.outputFps)} / {fps(p.nominalFps)} fps
          </dd>
        </div>
        <div>
          <dt>{t('Cores')}</dt>
          <dd className="tabular">{p.cores}</dd>
        </div>
        <div>
          <dt>{t('Running')}</dt>
          <dd className="tabular">
            {p.runningInputs} {p.runningInputs === 1 ? t('input') : t('inputs')} · {p.runningMics} {p.runningMics === 1 ? t('mic') : t('mics')}
          </dd>
        </div>
      </dl>

      <section className="perf-forecast" aria-labelledby="perf-fc">
        <div className="perf-fc-head">
          <h3 className="section-title" id="perf-fc">
            {t('Forecast')}
          </h3>
          <span className={`basis basis-${f.basis}`}>{basisLabel(f)}</span>
        </div>
        <p className="perf-room">{forecastSentence(f)}</p>
        <p className="meta">{costSentence(f)}</p>
        <p className="hint">
          {basisSentence(f)} {t('Room counts up to 80 % of the whole machine, other programs included.')}
        </p>
      </section>
    </div>
  )
}

/** Always-visible load in the header; opens the performance view. */
export function PerfButton() {
  const p = usePerf()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => anchor.current && !anchor.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])
  if (!p) return null
  const tone = perfTone(p)
  return (
    <div className="perf-anchor" ref={anchor}>
      <button
        type="button"
        className={`load load-${tone}`}
        aria-expanded={open}
        aria-controls="perf-pop"
        aria-label={`${t('Performance')}: ${toneLabel(p, tone)}`}
        title={`${t('Performance')}: ${toneLabel(p, tone)}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="activity" size={16} />
        <span className="tabular">
          {t('CPU')} <b>{num(p.cpu)} %</b>
        </span>
        <span className="tabular load-fps">
          <b>{fps(p.outputFps)}</b>/{fps(p.nominalFps)} fps
        </span>
      </button>
      {open && <PerfPanel p={p} onClose={() => setOpen(false)} />}
    </div>
  )
}
