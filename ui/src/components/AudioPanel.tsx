import { send, useLevels } from '../client'
import { formatDb } from '../helpers'
import { t } from '../i18n'
import { clampDelay, DELAY_MAX_MS } from '../strip'
import type { State } from '../types'
import { Fader, Meter, NumberField, Panel } from './ui'

function Strip({
  name,
  volume,
  muted,
  afv,
  peaks,
  onVolume,
  onMute,
  onAfv,
  master,
  delayMs,
  onDelay,
}: {
  name: string
  volume: number
  muted: boolean
  afv?: boolean
  peaks: [number, number] | undefined
  onVolume: (v: number) => void
  onMute: () => void
  onAfv?: () => void
  master?: boolean
  delayMs?: number
  onDelay?: (ms: number) => void
}) {
  return (
    <div className={`strip ${master ? 'strip-master' : ''} ${muted ? 'muted' : ''}`}>
      <span className="strip-name" title={name}>
        {name}
      </span>
      <div className="strip-body">
        <Meter peaks={peaks} />
        <Fader volume={volume} label={`${t('Volume')} ${name}`} onVolume={onVolume} />
      </div>
      <span className="strip-db">{formatDb(volume)} dB</span>
      <button type="button" className={`btn btn-sm btn-mute ${muted ? 'active' : ''}`} aria-pressed={muted} onClick={onMute}>
        {t('Mute')}
      </button>
      {onAfv && (
        <button
          type="button"
          className={`btn btn-sm ${afv ? 'selected' : ''}`}
          aria-pressed={!!afv}
          onClick={onAfv}
          title={t('Audio follows video')}
        >
          {t('AFV')}
        </button>
      )}
      {onDelay && (
        <NumberField
          className="field-strip-delay"
          label={t('Delay')}
          title={t('Lip-sync delay, 0 to 500 ms')}
          unit="ms"
          min={0}
          max={DELAY_MAX_MS}
          step={1}
          value={delayMs ?? 0}
          onCommit={(v) => onDelay(clampDelay(v))}
        />
      )}
    </div>
  )
}

export function AudioPanel({ state }: { state: State }) {
  const levels = useLevels()
  return (
    <Panel title={t('Audio')} className="audio">
      <p className="hint hint-top">{t('Delay per input: lip sync, 0 to 500 ms.')}</p>
      <div className="strips">
        {state.slots.map((s) => (
          <Strip
            key={s.slot}
            name={`${s.slot} ${s.name}`}
            volume={s.audio.volume}
            muted={s.audio.muted}
            afv={s.audio.afv}
            peaks={levels?.slots[s.slot]}
            onVolume={(volume) => send({ cmd: 'audio', slot: s.slot, volume })}
            onMute={() => send({ cmd: 'audio', slot: s.slot, muted: !s.audio.muted })}
            onAfv={() => send({ cmd: 'audio', slot: s.slot, afv: !s.audio.afv })}
            delayMs={s.audio.delayMs}
            onDelay={(delayMs) => send({ cmd: 'audio', slot: s.slot, delayMs })}
          />
        ))}
        <Strip
          master
          name={t('Master')}
          volume={state.master.volume}
          muted={state.master.muted}
          peaks={levels?.master}
          onVolume={(volume) => send({ cmd: 'master', volume })}
          onMute={() => send({ cmd: 'master', muted: !state.master.muted })}
        />
      </div>
    </Panel>
  )
}
