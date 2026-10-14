import { send } from '../client'
import { getLang, t } from '../i18n'
import { clampStrip, formatStrip, HPF_STEPS, sliderToStrip, STRIP_PRESETS, STRIP_RANGES, stripDiff, stripPresetMatches, stripToSlider, type StripNumKey } from '../strip'
import type { Mic, Strip } from '../types'
import { RangeField, Switch } from './ui'

/** Channel strip of one mic, in signal order. Every change sends only the fields that changed. */
export function StripEditor({ id, m }: { id: string; m: Mic }) {
  const s = m.strip
  const set = (patch: Partial<Strip>) => {
    const strip = stripDiff(s, patch)
    if (Object.keys(strip).length) send({ cmd: 'micStrip', mic: m.mic, strip })
  }
  const range = (key: StripNumKey, format?: (v: number) => string) => {
    const r = STRIP_RANGES[key]
    return (
      <RangeField
        label={t(r.label)}
        title={r.hint ? t(r.hint) : undefined}
        value={s[key]}
        min={r.min}
        max={r.max}
        step={r.step}
        scale={r.log ? { toPos: (v) => stripToSlider(r, v), fromPos: (p) => sliderToStrip(r, p) } : undefined}
        format={format ?? ((v) => formatStrip(r, v, getLang()))}
        onChange={(v) => set({ [key]: clampStrip(r, v) })}
      />
    )
  }

  return (
    <div id={id} className="strip-editor" role="group" aria-label={`${t('Channel strip')} ${t('Mic')} ${m.mic}`}>
      <div className="presets" role="group" aria-label={t('Presets')}>
        {STRIP_PRESETS.map((p) => {
          const on = stripPresetMatches(p, s)
          return (
            <button key={p.id} type="button" className={`chip ${on ? 'selected' : ''}`} aria-pressed={on} onClick={() => set(p.strip)}>
              {t(p.label)}
            </button>
          )
        })}
      </div>

      <div className="stage">
        <Switch
          on={s.denoise}
          onChange={(denoise) => set({ denoise })}
          label={
            <>
              {t('Denoise')}
              <small>{t('Switching restarts the mic briefly')}</small>
            </>
          }
        />
      </div>

      <div className={`stage ${s.hpfHz > 0 ? '' : 'stage-off'}`}>
        <div className="stage-head">
          <span className="stage-title">{t('High-pass')}</span>
          <div className="presets" role="group" aria-label={t('High-pass')}>
            {HPF_STEPS.map((hz) => (
              <button
                key={hz}
                type="button"
                className={`chip chip-sm ${Math.round(s.hpfHz) === hz ? 'selected' : ''}`}
                aria-pressed={Math.round(s.hpfHz) === hz}
                onClick={() => set({ hpfHz: hz })}
              >
                {hz === 0 ? t('Off') : hz}
              </button>
            ))}
          </div>
        </div>
        {range('hpfHz', (v) => (v <= 0 ? t('Off') : formatStrip(STRIP_RANGES.hpfHz, v, getLang())))}
      </div>

      <div className={`stage ${s.gate ? '' : 'stage-off'}`}>
        <Switch on={s.gate} onChange={(gate) => set({ gate })} label={t('Gate')} className="stage-switch" />
        {range('gateThresholdDb')}
        {range('gateRangeDb')}
      </div>

      <div className={`stage ${s.comp ? '' : 'stage-off'}`}>
        <Switch on={s.comp} onChange={(comp) => set({ comp })} label={t('Compressor')} className="stage-switch" />
        {range('compThresholdDb')}
        {range('compRatio')}
        {range('compAttackMs')}
        {range('compReleaseMs')}
      </div>

      <div className="stage">{range('makeupDb')}</div>
    </div>
  )
}
